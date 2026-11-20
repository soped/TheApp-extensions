from collections.abc import Callable
from datetime import datetime, timezone

from system.interfaces.service_plugin_interface import ServicePluginInterface

from extensions.plugins.email_sender.services.v1 import _smtp as smtp


class WorkerSendEmail(ServicePluginInterface):
    """Sends one email through an SMTP server when the workflow reaches this step.

    The password is never part of the settings: `secret` names an entry in the organization
    password vault and is read at send time through the runner-injected
    `self.params["drivers"]["vault"]` (a `get(name)` capability); without it the step fails.
    Settings: `smtp` {host, port, security: starttls|ssl|none}, `username`, `sender` (defaults
    to username), `secret`, `recipients` (list), `subject`, `message`. `${field}` in subject and
    message is filled from the first item of the previous result (or a result object).
    `include_last_result` (boolean, default false) appends the full previous result as JSON.
    """

    ORGANIZATION_SAFE = True
    WORKER_ROLES = ("step",)

    smtp_factory = None

    def run(self, params: dict | None = None, previous_result: list | dict | None = None, return_callback: Callable | None = None):
        settings = smtp.validate(params)
        first = previous_result if isinstance(previous_result, dict) else next(
            (item for item in (previous_result or []) if isinstance(item, dict)), None)
        message = smtp.build_message(settings, first, previous_result)

        vault = (self.params.get("drivers") or {}).get("vault")
        if vault is None:
            raise RuntimeError("The organization password vault is not available to this worker")
        password = vault.get(settings["secret"])
        if not password:
            raise RuntimeError(f"Vault secret '{settings['secret']}' is not set")

        smtp.send(settings, password, message, self.smtp_factory)
        results = [{
            "sent": True, "recipients": settings["recipients"], "subject": message["Subject"],
            "sent_at": datetime.now(timezone.utc).isoformat(),
        }]
        if return_callback:
            return_callback(results)
        return results
