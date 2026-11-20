"""Organization-admin management of runner workflow configuration.

GET    /api/v1/workflows/Workflows/            list workflows
GET    /api/v1/workflows/Workflows/<id>/       one workflow
POST   /api/v1/workflows/Workflows/            create (name, group, active, interval_seconds, cron, timezone, worker_node, trigger, workflow)
POST   /api/v1/workflows/Workflows/<id>/update  change any of those fields
POST   /api/v1/workflows/Workflows/<id>/enable|disable
POST   /api/v1/workflows/Workflows/<id>/delete  delete

The platform plugin route accepts only GET and POST; PUT/DELETE handling remains for
direct callers but is not reachable over HTTP.

All access goes through the platform `workflows` driver, which enforces the verified
organization and the administrator requirement.
"""

from system.interfaces.api_plugin_interface import ApiPluginInterface
from system.modules import crud_access

from extensions.plugins.workflows.api.v1 import _common as common


class Workflows(ApiPluginInterface):
    def run(self, params=None):
        params = params or {}
        method = params.get("method")
        try:
            driver = common.workflows_driver(self.params)
            dynamic = common.dynamic_of(params)
            workflow_id = dynamic[0] if dynamic else common.arg(params, "id")
            action = dynamic[1] if len(dynamic) > 1 else None
            body = common.body_of(params)

            if method == "GET":
                if workflow_id:
                    return {"workflow": driver.get(workflow_id)}, 200
                return {"workflows": driver.list()}, 200
            if method == "POST":
                if workflow_id:
                    # The widget API client only sends GET and POST, so update/delete have POST forms.
                    if action == "update":
                        return {"workflow": driver.update(workflow_id, body)}, 200
                    if action == "delete":
                        driver.delete(workflow_id)
                        return {"deleted": workflow_id}, 200
                    if action not in ("enable", "disable"):
                        return {"error": "Use /<id>/enable, /disable, /update or /delete"}, 400
                    return {"workflow": driver.update(workflow_id, {"active": action == "enable"})}, 200
                return {"workflow": driver.create(body)}, 201
            if method in ("PUT", "PATCH"):
                if not workflow_id:
                    return {"error": "A workflow id is required"}, 400
                return {"workflow": driver.update(workflow_id, body)}, 200
            if method == "DELETE":
                if not workflow_id:
                    return {"error": "A workflow id is required"}, 400
                driver.delete(workflow_id)
                return {"deleted": workflow_id}, 200
            return {"error": "Use GET, POST, PUT or DELETE"}, 405
        except crud_access.AccessDenied as error:
            return {"error": error.message}, error.status
