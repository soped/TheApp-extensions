"""Organization-scoped administration."""

import logging

from pymongo.errors import PyMongoError

from system.modules import crud_access
from system.modules.documents import json_body, serialize


def run_organization(identity, request, operation):
    try:
        crud_access.require_admin(identity)
        organizations = crud_access.collection(identity, "organizations")
        query = {"_id": crud_access.organization_id(identity)}
        if operation == "Read":
            document = organizations.find_one(query)
            if not document:
                raise crud_access.AccessDenied("Organization not found", 404)
            return [serialize(document)], 200
        if request.get("method") != "POST":
            raise crud_access.AccessDenied("Writes require POST", 405)
        data = json_body(request)
        if set(data) != {"name"} or not isinstance(data["name"], str) or not data["name"].strip() or len(data["name"]) > 120:
            raise crud_access.AccessDenied("Provide an organization name (up to 120 characters)", 400)
        result = organizations.update_one(query, {"$set": {"name": data["name"].strip()}})
        if not result.matched_count:
            raise crud_access.AccessDenied("Organization not found", 404)
        return {"matched": result.matched_count, "modified": result.modified_count}, 200
    except crud_access.AccessDenied as error:
        return {"error": error.message}, error.status
    except PyMongoError:
        logging.getLogger(__name__).exception("Organization operation failed")
        return {"error": "Database operation failed"}, 500
