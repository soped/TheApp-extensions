"""Organization-scoped account validation, persistence and token issuance."""

import logging

from pymongo.errors import DuplicateKeyError, PyMongoError

from system.modules import crud_access, memberships, passwords
from system.modules.documents import json_body, serialize
from system.modules.jwt_generator import JwtGenerator, ACCESS_TOKEN_EXPIRY, REFRESH_TOKEN_EXPIRY


def user_fields(data, creating=False):
    allowed = {"username", "properties", "disabled"}
    if creating:
        allowed |= {"password"}
    if set(data) - allowed:
        raise crud_access.AccessDenied("Unknown user fields", 400)
    changes = {key: value for key, value in data.items() if key != "password"}
    username = data.get("username")
    if (creating or "username" in data) and (not isinstance(username, str) or not username.strip() or len(username) > 120):
        raise crud_access.AccessDenied("username is required (up to 120 characters)", 400)
    if username is not None:
        changes["username"] = username.strip()
    if "disabled" in data and type(data["disabled"]) is not bool:
        raise crud_access.AccessDenied("disabled must be a boolean", 400)
    properties = data.get("properties", {})
    if not isinstance(properties, dict) or set(properties) - {"user_type", "account_type", "display_name", "task_assignable", "cmdb_rights"}:
        raise crud_access.AccessDenied("Supported properties: user_type, account_type, display_name, task_assignable, cmdb_rights", 400)
    if properties.get("user_type", "user") not in ("admin", "user") or properties.get("account_type", "user") not in ("user", "service"):
        raise crud_access.AccessDenied("Expected account_type user or service and user_type admin or user", 400)
    if not isinstance(properties.get("display_name", ""), str):
        raise crud_access.AccessDenied("display_name must be a string", 400)
    if "task_assignable" in properties and type(properties["task_assignable"]) is not bool:
        raise crud_access.AccessDenied("task_assignable must be a boolean", 400)
    rights = properties.get("cmdb_rights", [])
    if not isinstance(rights, list) or set(rights) - {"write", "edit"}:
        raise crud_access.AccessDenied("cmdb_rights must be a list of write and edit", 400)
    if creating or "properties" in data:
        changes["properties"] = {"user_type": "user", "account_type": "user"} | properties
    if creating:
        if changes["properties"]["account_type"] == "service":
            if "password" in data:
                raise crud_access.AccessDenied("Service accounts use refresh tokens, not passwords", 400)
        else:
            secret = data.get("password")
            if not isinstance(secret, str) or len(secret) < 12:
                raise crud_access.AccessDenied("Password must have at least 12 characters", 400)
            changes["password"] = passwords.hash_password(secret)
        changes["token_version"] = 0
        changes.setdefault("disabled", False)
    return changes


def service_refresh_token(identity, user):
    config = identity.get("jwt") or {}
    tokens = JwtGenerator.generate_tokens(
        subject=user["username"],
        organization_id=str(user["organization_id"]),
        properties=user["properties"],
        secret=config.get("secret_key"),
        issuer=config.get("issuer"),
        token_version=user.get("token_version", 0),
        access_token_expiry=int(config.get("access_token_expiry_seconds", ACCESS_TOKEN_EXPIRY)),
        refresh_token_expiry=int(config.get("refresh_token_expiry_seconds", REFRESH_TOKEN_EXPIRY)),
    )
    return tokens["refresh_token"]


def run_users(identity, request, operation):
    try:
        crud_access.require_admin(identity)
        if operation != "Read" and request.get("method") != "POST":
            raise crud_access.AccessDenied("Writes require POST", 405)
        users = crud_access.collection(identity, "users")
        query = crud_access.scoped_query(identity, {})
        dynamic = request.get("kwargs", {}).get("dynamic", [])
        data = json_body(request)
        if operation == "Read":
            org_id = crud_access.organization_id(identity)
            inherited = memberships.inherited_services(identity["drivers"]["mongodb"], org_id)
            if dynamic:
                query["_id"] = crud_access.object_id(dynamic[0], "user id")
                inherited = [user for user in inherited if user["_id"] == query["_id"]]
            result = list(users.find(query, {"password": 0, "auth_key": 0, "registry_auth_hash": 0}))
            for user in inherited:
                parent = crud_access.collection(identity, "organizations").find_one({"_id": user["organization_id"]})
                result.append({"_id": user["_id"], "username": user["username"],
                               "organization_id": user["organization_id"], "disabled": user.get("disabled", False),
                               "inherited_from": str(user["organization_id"]),
                               "inherited_from_name": parent.get("name", "") if parent else "",
                               "properties": {key: value for key, value in (user.get("properties") or {}).items()
                                              if key in {"account_type", "user_type", "display_name", "task_assignable", "cmdb_rights"}}})
            return serialize(sorted(result, key=lambda user: user["username"])), 200
        if operation == "Create":
            if dynamic:
                raise crud_access.AccessDenied("Create does not accept a user id", 400)
            document = crud_access.scoped_document(identity, user_fields(data, creating=True))
            credentials = {}
            if document["properties"]["account_type"] == "service":
                credentials["refresh_token"] = service_refresh_token(identity, document)
            result = users.insert_one(document)
            return {"inserted_id": str(result.inserted_id)} | credentials, 201
        if not dynamic or len(dynamic) > 2:
            raise crud_access.AccessDenied("User id is required", 400)
        query["_id"] = crud_access.object_id(dynamic[0], "user id")
        user = users.find_one(query)
        if not user:
            raise crud_access.AccessDenied("User not found", 404)
        if user["username"] == identity["identity"]["username"]:
            raise crud_access.AccessDenied("Use another administrator to modify your own account", 403)
        if (user.get("properties") or {}).get("account_type", "user") != "service":
            raise crud_access.AccessDenied("Manage human memberships through organization membership administration", 403)
        if operation == "Delete":
            users.delete_one(query)
            return {"deleted": 1}, 200
        aspect = dynamic[1] if len(dynamic) == 2 else "info"
        credentials = {}
        if aspect == "credentials":
            if (user.get("properties") or {}).get("account_type") == "service":
                if data:
                    raise crud_access.AccessDenied("Service token rotation requires an empty JSON object", 400)
                if user.get("disabled", False):
                    raise crud_access.AccessDenied("Enable this service account before rotating its token", 400)
                next_user = user | {"token_version": user.get("token_version", 0) + 1}
                credentials["refresh_token"] = service_refresh_token(identity, next_user)
                changes = {}
            else:
                secret = data.get("password")
                if set(data) != {"password"} or not isinstance(secret, str) or len(secret) < 12:
                    raise crud_access.AccessDenied("Provide a password of at least 12 characters", 400)
                changes = {"password": passwords.hash_password(secret)}
        elif aspect == "info":
            changes = user_fields(data)
            if "properties" in data:
                account_type = (user.get("properties") or {}).get("account_type", "user")
                if data["properties"].get("account_type", account_type) != account_type:
                    raise crud_access.AccessDenied("Account type cannot be changed; create a new account instead", 400)
                changes["properties"] = (user.get("properties") or {}) | data["properties"]
            if not changes:
                raise crud_access.AccessDenied("Provide user fields to update", 400)
        else:
            raise crud_access.AccessDenied("Unknown user aspect", 400)
        query["token_version"] = user["token_version"] if "token_version" in user else {"$exists": False}
        result = users.update_one(query, {"$set": changes, "$inc": {"token_version": 1}})
        if not result.matched_count:
            raise crud_access.AccessDenied("User changed during this request; reload and try again", 409)
        return {"matched": result.matched_count, "modified": result.modified_count} | credentials, 200
    except crud_access.AccessDenied as error:
        return {"error": error.message}, error.status
    except DuplicateKeyError:
        return {"error": "Username already exists"}, 409
    except PyMongoError:
        logging.getLogger(__name__).exception("User operation failed")
        return {"error": "Database operation failed"}, 500
