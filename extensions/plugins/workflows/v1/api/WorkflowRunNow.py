"""POST /api/v1/workflows/WorkflowRunNow/ queues one run (admins only).

Body: {"workflow_id": "<id>"} or {"plugin": "pkg.Name", "params": {...}}.
The run is queued (status "queued" in config_workflow_runs); the platform
service runner (system.modules.tenant_runner) executes it and records the result.
"""

from system.interfaces.api_plugin_interface import ApiPluginInterface
from system.modules import crud_access

from extensions.plugins.workflows.api.v1 import _common as common

ALLOWED = {"workflow_id", "plugin", "params"}


class WorkflowRunNow(ApiPluginInterface):
    def run(self, params=None):
        params = params or {}
        if params.get("method") != "POST":
            return {"error": "Use POST"}, 405
        try:
            body = common.body_of(params)
            unknown = sorted(set(body) - ALLOWED)
            if unknown:
                return {"error": f"Unsupported fields: {', '.join(unknown)}"}, 400
            driver = common.workflows_driver(self.params)
            dynamic = common.dynamic_of(params)
            workflow_id = body.get("workflow_id") or (dynamic[0] if dynamic else None)
            result = driver.run_now(workflow_id=workflow_id, plugin=body.get("plugin"), params=body.get("params"))
            return {"run": result}, 202
        except crud_access.AccessDenied as error:
            return {"error": error.message}, error.status
