"""GET /api/v1/workflows/WorkflowRuns/?workflow_id=<id>&limit=50 reads run history (admins only)."""

from system.interfaces.api_plugin_interface import ApiPluginInterface
from system.modules import crud_access

from extensions.plugins.workflows.api.v1 import _common as common


class WorkflowRuns(ApiPluginInterface):
    def run(self, params=None):
        params = params or {}
        if params.get("method") != "GET":
            return {"error": "Use GET"}, 405
        try:
            dynamic = common.dynamic_of(params)
            workflow_id = dynamic[0] if dynamic else common.arg(params, "workflow_id")
            raw_limit = common.arg(params, "limit")
            try:
                limit = int(raw_limit) if raw_limit is not None else 50
            except (TypeError, ValueError):
                return {"error": "limit must be a whole number"}, 400
            driver = common.workflows_driver(self.params)
            return {"runs": driver.runs(workflow_id, limit)}, 200
        except crud_access.AccessDenied as error:
            return {"error": error.message}, error.status
