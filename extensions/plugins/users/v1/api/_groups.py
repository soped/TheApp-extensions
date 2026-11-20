"""Organization-scoped user groups; members are usernames of active organization members."""

import logging

from pymongo.errors import DuplicateKeyError, PyMongoError

from system.modules import crud_access, memberships
from system.modules.documents import json_body, serialize

COLLECTION = "user_groups"


def group_fields(data, creating=False):
    allowed = {"name", "description", "members"}
    if set(data) - allowed:
        raise crud_access.AccessDenied("Supported fields: name, description, members", 400)
    changes = {}
    if creating or "name" in data:
        name = data.get("name")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
            raise crud_access.AccessDenied("name is required (up to 80 characters)", 400)
        changes["name"] = name.strip()
    if "description" in data or creating:
        description = data.get("description", "")
        if not isinstance(description, str) or len(description) > 500:
            raise crud_access.AccessDenied("description must be text of up to 500 characters", 400)
        changes["description"] = description
    if "members" in data or creating:
        members = data.get("members", [])
        if (not isinstance(members, list) or len(members) > 500
                or any(not isinstance(item, str) or not item.strip() or len(item) > 120 for item in members)):
            raise crud_access.AccessDenied("members must be a list of up to 500 usernames", 400)
        changes["members"] = sorted({item.strip() for item in members})
    return changes


def active_usernames(identity):
    """Usernames with an active membership in the verified organization."""
    org_id = crud_access.organization_id(identity)
    db = identity["drivers"]["mongodb"]
    ids = {row["user_id"] for row in db.get_collection("memberships").find(
        {"organization_id": org_id, "status": "active"})}
    ids.update(row["_id"] for row in db.get_collection("users").find({"organization_id": org_id}))
    names = set()
    for user in db.get_collection("users").find({"_id": {"$in": list(ids)}}):
        if memberships.membership(db, user, org_id):
            names.add(user["username"])
    return names


def check_members(identity, members):
    unknown = sorted(set(members) - active_usernames(identity))
    if unknown:
        raise crud_access.AccessDenied(f"Not active members of this organization: {', '.join(unknown)}", 400)


def run_groups(identity, request):
    try:
        crud_access.require_admin(identity)
        groups = crud_access.collection(identity, COLLECTION)
        query = crud_access.scoped_query(identity, {})
        dynamic = request.get("kwargs", {}).get("dynamic", [])
        method = request.get("method")
        if method == "GET":
            if dynamic:
                query["_id"] = crud_access.object_id(dynamic[0], "group id")
            return serialize(list(groups.find(query).sort("name", 1))), 200
        if method != "POST":
            raise crud_access.AccessDenied("Writes require POST", 405)
        data = json_body(request)
        if not dynamic:
            changes = group_fields(data, creating=True)
            check_members(identity, changes["members"])
            if groups.find_one(query | {"name": changes["name"]}):
                raise crud_access.AccessDenied("A group with this name already exists", 409)
            result = groups.insert_one(crud_access.scoped_document(identity, changes))
            return {"inserted_id": str(result.inserted_id)}, 201
        if len(dynamic) > 2 or (len(dynamic) == 2 and dynamic[1] != "delete"):
            raise crud_access.AccessDenied("Expected a group id and optional delete", 400)
        query["_id"] = crud_access.object_id(dynamic[0], "group id")
        if len(dynamic) == 2:
            if data:
                raise crud_access.AccessDenied("Deleting a group requires an empty JSON object", 400)
            result = groups.delete_one(query)
            if not result.deleted_count:
                raise crud_access.AccessDenied("Group not found", 404)
            return {"deleted": 1}, 200
        changes = group_fields(data)
        if not changes:
            raise crud_access.AccessDenied("Provide group fields to update", 400)
        if "members" in changes:
            check_members(identity, changes["members"])
        if "name" in changes and groups.find_one(query | {"_id": {"$ne": query["_id"]}, "name": changes["name"]}):
            raise crud_access.AccessDenied("A group with this name already exists", 409)
        result = groups.update_one(query, {"$set": changes})
        if not result.matched_count:
            raise crud_access.AccessDenied("Group not found", 404)
        return {"matched": result.matched_count, "modified": result.modified_count}, 200
    except crud_access.AccessDenied as error:
        return {"error": error.message}, error.status
    except DuplicateKeyError:
        return {"error": "A group with this name already exists"}, 409
    except PyMongoError:
        logging.getLogger(__name__).exception("Group operation failed")
        return {"error": "Group operation failed"}, 500
