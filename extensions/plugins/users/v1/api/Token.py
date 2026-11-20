"""POST /api/v1/users/Token/<id>/; issue a service refresh token without revocation."""

import logging

from pymongo.errors import PyMongoError

from extensions.plugins.users.api.v1._admin import service_refresh_token
from system.interfaces.api_plugin_interface import ApiPluginInterface
from system.modules import crud_access
from system.modules.documents import json_body


class Token(ApiPluginInterface):
    def run(self, params=None):
        request = params or {}
        try:
            crud_access.require_admin(self.params)
            if request.get("method") != "POST":
                raise crud_access.AccessDenied("Token issuance requires POST", 405)
            dynamic = request.get("kwargs", {}).get("dynamic", [])
            if len(dynamic) != 1:
                raise crud_access.AccessDenied("A single user id is required", 400)
            if json_body(request):
                raise crud_access.AccessDenied("Token issuance requires an empty JSON object", 400)
            query = crud_access.scoped_query(self.params, {
                "_id": crud_access.object_id(dynamic[0], "user id"),
            })
            user = crud_access.collection(self.params, "users").find_one(query)
            if not user:
                raise crud_access.AccessDenied("User not found", 404)
            if (user.get("properties") or {}).get("account_type") != "service":
                raise crud_access.AccessDenied("Refresh tokens can only be issued for service accounts", 400)
            if user.get("disabled", False):
                raise crud_access.AccessDenied("Enable this service account before issuing a token", 400)
            return {"refresh_token": service_refresh_token(self.params, user)}, 200
        except crud_access.AccessDenied as error:
            return {"error": error.message}, error.status
        except PyMongoError:
            logging.getLogger(__name__).exception("Service token issuance failed")
            return {"error": "Database operation failed"}, 500
