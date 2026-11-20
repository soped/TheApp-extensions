"""Install app defaults once and manage private organization/user/app layouts."""

import hashlib
import json
import logging
import re

from pymongo.errors import PyMongoError

from system.interfaces.api_plugin_interface import ApiPluginInterface
from system.modules import crud_access
from system.modules.documents import validate_document
from extensions.plugins.crud.api.v1._pages import validate_page


class Pages(ApiPluginInterface):
    def run(self, params=None):
        try:
            request = params or {}
            if request.get("method") != "POST":
                raise crud_access.AccessDenied("Use POST", 405)
            body = request.get("json")
            if not isinstance(body, dict):
                raise crud_access.AccessDenied("JSON body must be an object", 400)
            app = body.get("app")
            if not isinstance(app, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,79}", app):
                raise crud_access.AccessDenied("A valid app id is required", 400)
            identity = self.params.get("identity", {})
            user = identity.get("user_id") or identity.get("username")
            if not user:
                raise crud_access.AccessDenied("User identity required", 403)
            scope = {"organization_id": crud_access.organization_id(self.params),
                     "user_id": str(user), "app": app}
            collection = crud_access.collection(self.params, "user_app_pages")

            def page_id(slug):
                return hashlib.sha256(json.dumps(
                    [str(scope["organization_id"]), scope["user_id"], app, slug],
                    separators=(",", ":")).encode()).hexdigest()

            def clean(page):
                if not isinstance(page, dict):
                    raise crud_access.AccessDenied("Page must be an object", 400)
                validate_document(page)
                validate_page(page)
                return {key: value for key, value in page.items() if key not in ("_id", "organization_id")}

            action = body.get("action", "list")
            result = {}
            if action == "install":
                defaults = body.get("defaults")
                if not isinstance(defaults, list) or len(defaults) > 500:
                    raise crud_access.AccessDenied("defaults must be a list of at most 500 pages", 400)
                pages = [clean(page) for page in defaults]
                if len({page["slug"] for page in pages}) != len(pages):
                    raise crud_access.AccessDenied("Default page slugs must be unique", 400)
                for page in pages:
                    collection.update_one({**scope, "_id": page_id(page["slug"])},
                                          {"$setOnInsert": {**page, "revision": 1, "deleted": False}},
                                          upsert=True)
            elif action == "create":
                page = clean(body.get("page"))
                key = page_id(page["slug"])
                inserted = collection.update_one({**scope, "_id": key},
                    {"$setOnInsert": {**page, "revision": 1, "deleted": False}}, upsert=True)
                if not inserted.upserted_id:
                    raise crud_access.AccessDenied("This page slug already exists or was previously removed; choose a new slug", 409)
                result["inserted_id"] = key
            elif action in ("update", "delete"):
                key, revision = body.get("id"), body.get("revision")
                if not isinstance(key, str) or not re.fullmatch(r"[a-f0-9]{64}", key) or type(revision) is not int:
                    raise crud_access.AccessDenied("Page id and revision are required", 400)
                changes = clean(body.get("page")) if action == "update" else {"deleted": True}
                if action == "update":
                    existing = collection.find_one({**scope, "_id": key, "deleted": False})
                    if not existing:
                        raise crud_access.AccessDenied("Page not found", 404)
                    if changes["slug"] != existing["slug"]:
                        raise crud_access.AccessDenied("Installed page slugs are stable; create a new page to change the slug", 400)
                changed = collection.update_one({**scope, "_id": key, "revision": revision, "deleted": False},
                                                {"$set": changes, "$inc": {"revision": 1}})
                if not changed.matched_count:
                    raise crud_access.AccessDenied("Page changed or was removed; refresh before saving again", 409)
            elif action != "list":
                raise crud_access.AccessDenied("Unknown page-manager action", 400)
            pages = list(collection.find({**scope, "deleted": False}).sort("_id", 1).limit(501))
            if len(pages) > 500:
                raise crud_access.AccessDenied("Too many app pages; remove unused pages before continuing", 409)
            result["pages"] = [{key: value for key, value in page.items()
                                if key in ("_id", "title", "slug", "type", "url", "widgets", "revision")} for page in pages]
            return result, 200
        except crud_access.AccessDenied as error:
            return {"error": error.message}, error.status
        except PyMongoError:
            logging.getLogger(__name__).exception("App page operation failed")
            return {"error": "App page database operation failed"}, 500
