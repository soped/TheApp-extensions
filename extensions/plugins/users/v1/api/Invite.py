"""POST /api/v1/users/Invite/; create a human account for an email address and email its password.

The SMTP account is the organization's own `email_sender.WorkerSendEmail` workflow step (for
example the Gmail account used by build notifications); its password stays in the organization
vault and is decrypted only for the SMTP login. The generated password is sent only to the
invited address and is never returned, logged or stored in plaintext.
"""

import logging
import re
import secrets
from datetime import datetime, timezone
from email.message import EmailMessage

from pymongo.errors import DuplicateKeyError, PyMongoError

from extensions.plugins.email_sender.services.v1 import _smtp
from extensions.plugins.users.api.v1._admin import user_fields
from system.interfaces.api_plugin_interface import ApiPluginInterface
from system.modules import crud_access, vault
from system.modules.documents import json_body

EMAIL_STEP = "email_sender.WorkerSendEmail"
ORIGIN = re.compile(r"https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?")
FIELDS = {"email", "user_type", "display_name", "task_assignable"}
log = logging.getLogger(__name__)


def smtp_settings(db, org_id, recipient):
    """Settings of the first active email workflow step in this organization."""
    workers = db.get_collection("config_workers").find(
        {"organization_id": {"$in": [org_id, str(org_id)]}, "active": True,
         "workflow.plugin": EMAIL_STEP}).sort([("created_at", 1), ("_id", 1)])
    for worker in workers:
        for step in worker.get("workflow") or []:
            if isinstance(step, dict) and step.get("plugin") == EMAIL_STEP:
                try:
                    return _smtp.validate((step.get("params") or {}) | {"recipients": [recipient]})
                except ValueError:
                    continue
    raise crud_access.AccessDenied(
        "No email account is configured. Add an active workflow with an email_sender "
        "Send email step (SMTP settings and vault secret) to send invitations.", 409)


def smtp_password(db, org_id, name, actor):
    document = db.get_collection(vault.ENTRIES).find_one(
        {"_id": f"{org_id}:{name}", "organization_id": org_id, "name": name})
    if not document:
        raise crud_access.AccessDenied(f"Vault entry '{name}' for the email account was not found", 409)
    value = vault.decrypt(document)
    db.get_collection(vault.AUDIT).insert_one({
        "organization_id": org_id, "actor": actor, "action": "invitation_email_read",
        "name": name, "at": datetime.now(timezone.utc)})
    return value


def invitation(settings, email, password, organization, login_url):
    message = EmailMessage()
    message["From"] = settings["sender"]
    message["To"] = email
    message["Subject"] = f"You have been invited to {organization}"
    lines = ["Hello,", "", f"An administrator has created an account for you in {organization}.", ""]
    if login_url:
        lines.append(f"Sign in at: {login_url}")
    lines += [f"Username: {email}", f"Password: {password}", "",
              "Keep this password private and delete this email once you have stored it safely.",
              "If you did not expect this invitation, you can ignore this email."]
    message.set_content("\n".join(lines))
    return message


class Invite(ApiPluginInterface):
    smtp_factory = None

    def run(self, params=None):
        request = params or {}
        users = None
        inserted = None
        try:
            crud_access.require_admin(self.params)
            if request.get("method") != "POST":
                raise crud_access.AccessDenied("Invitations require POST", 405)
            if request.get("kwargs", {}).get("dynamic"):
                raise crud_access.AccessDenied("Invite does not accept a user id", 400)
            data = json_body(request)
            if set(data) - FIELDS:
                raise crud_access.AccessDenied(f"Supported fields: {', '.join(sorted(FIELDS))}", 400)
            email = data.get("email")
            if not isinstance(email, str) or len(email.strip()) > 120 or not _smtp.ADDRESS.fullmatch(email.strip()):
                raise crud_access.AccessDenied("Provide a valid email address", 400)
            email = email.strip()
            properties = {key: data[key] for key in ("user_type", "display_name", "task_assignable") if key in data}
            password = secrets.token_urlsafe(18)
            document = crud_access.scoped_document(self.params, user_fields(
                {"username": email, "password": password, "properties": properties | {"account_type": "user"}},
                creating=True))
            org_id = document["organization_id"]
            db = self.params["drivers"]["mongodb"]
            users = crud_access.collection(self.params, "users")
            if users.find_one({"username": email}, {"_id": 1}):
                raise crud_access.AccessDenied(
                    "An account with this email already exists; invite it by username instead", 409)
            settings = smtp_settings(db, org_id, email)
            smtp_secret = smtp_password(db, org_id, settings["secret"],
                                        f"user:{self.params['identity']['username']}")
            organization = (db.get_collection("organizations").find_one({"_id": org_id}, {"name": 1}) or {}).get(
                "name") or "the organization"
            origin = (request.get("headers") or {}).get("Origin", "")
            message = invitation(settings, email, password, organization,
                                 origin if ORIGIN.fullmatch(origin or "") else "")
            inserted = users.insert_one(document).inserted_id
            try:
                _smtp.send(settings, smtp_secret, message, self.smtp_factory)
            except Exception:  # noqa: BLE001 - any delivery failure must undo the account
                log.exception("Invitation email delivery failed for organization %s", org_id)
                users.delete_one({"_id": inserted, "organization_id": org_id})
                return {"error": "The invitation email could not be sent, so no account was created. "
                                 "Check the email workflow's SMTP settings and vault secret."}, 502
            return {"inserted_id": str(inserted), "username": email, "email_sent": True}, 201
        except crud_access.AccessDenied as error:
            return {"error": error.message}, error.status
        except DuplicateKeyError:
            return {"error": "An account with this email already exists; invite it by username instead"}, 409
        except PyMongoError:
            log.exception("Invitation failed")
            if inserted is not None and users is not None:
                try:
                    users.delete_one({"_id": inserted})
                except PyMongoError:
                    log.exception("Could not remove the uninvited account")
            return {"error": "Database operation failed"}, 500
