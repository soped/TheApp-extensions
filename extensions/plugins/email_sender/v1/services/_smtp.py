"""Settings validation, `${path}` templating and SMTP delivery for WorkerSendEmail."""

import json
import re
import smtplib
import ssl
from email.message import EmailMessage

SECURITY = ("starttls", "ssl", "none")
TEMPLATE = re.compile(r"\$\{([A-Za-z0-9_.]+)\}")
ADDRESS = re.compile(r"[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+")
SECRET_NAME = re.compile(r"[a-z][a-z0-9_-]{0,79}")
TIMEOUT_SECONDS = 30
MAX_RECIPIENTS = 50


def _text(params, key, required=False):
    value = params.get(key, "")
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ValueError(f"{key} must be a string")
    value = value.strip() if key not in ("message",) else value
    if required and not value:
        raise ValueError(f"{key} is required")
    return value


def validate(params):
    """Return normalized settings or raise ValueError describing the first problem."""
    params = params or {}
    smtp = params.get("smtp")
    if not isinstance(smtp, dict):
        raise ValueError("smtp must be an object with host, port and security")
    host = _text(smtp, "host", True)
    port = smtp.get("port")
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise ValueError("smtp.port must be an integer between 1 and 65535")
    security = smtp.get("security", "starttls")
    if security not in SECURITY:
        raise ValueError(f"smtp.security must be one of {', '.join(SECURITY)}")
    username = _text(params, "username", True)
    sender = _text(params, "sender") or username
    if not ADDRESS.fullmatch(sender):
        raise ValueError("sender must be an email address (or leave it empty to use the username)")
    secret = _text(params, "secret", True)
    if not SECRET_NAME.fullmatch(secret):
        raise ValueError("secret must be a vault entry name (lowercase letters, digits, _ or -)")
    recipients = params.get("recipients")
    include_last_result = params.get("include_last_result", False)
    if not isinstance(include_last_result, bool):
        raise ValueError("include_last_result must be a boolean")
    if (not isinstance(recipients, list) or not recipients or len(recipients) > MAX_RECIPIENTS
            or not all(isinstance(item, str) and ADDRESS.fullmatch(item.strip()) for item in recipients)):
        raise ValueError(f"recipients must be a list of 1-{MAX_RECIPIENTS} email addresses")
    return {
        "smtp": {"host": host, "port": port, "security": security},
        "username": username, "sender": sender, "secret": secret,
        "recipients": [item.strip() for item in recipients],
        "subject": _text(params, "subject"), "message": _text(params, "message"),
        "include_last_result": include_last_result,
    }


def lookup(item, path):
    value = item
    for part in path.split("."):
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            raise ValueError(f"template field '{path}' is missing from the previous result")
    return value


def render(template, item):
    if not item:
        return template
    return TEMPLATE.sub(lambda match: str(lookup(item, match.group(1))), template)


def build_message(settings, item=None, previous_result=None):
    subject = render(settings["subject"], item)
    if "\n" in subject or "\r" in subject:
        raise ValueError("subject must be a single line")
    message = EmailMessage()
    message["From"] = settings["sender"]
    message["To"] = ", ".join(settings["recipients"])
    message["Subject"] = subject
    body = render(settings["message"], item)
    if settings.get("include_last_result", False) and previous_result is not None:
        body += "\n\nPrevious step result:\n" + json.dumps(
            previous_result, ensure_ascii=True, indent=2, allow_nan=False)
    message.set_content(body)
    return message


def send(settings, password, message, smtp_factory=None):
    """Deliver `message`; the password is only used for login and never stored or returned."""
    smtp = settings["smtp"]
    security = smtp["security"]
    context = ssl.create_default_context()
    if smtp_factory is not None:
        client = smtp_factory(smtp["host"], smtp["port"], security)
    elif security == "ssl":
        client = smtplib.SMTP_SSL(smtp["host"], smtp["port"], timeout=TIMEOUT_SECONDS, context=context)
    else:
        client = smtplib.SMTP(smtp["host"], smtp["port"], timeout=TIMEOUT_SECONDS)
    with client:
        if security == "starttls":
            client.starttls(context=context)
        client.login(settings["username"], password)
        client.send_message(message, from_addr=settings["sender"], to_addrs=settings["recipients"])
