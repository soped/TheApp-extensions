"""GET /api/v1/workflows/WorkflowPlugins/ lists the installed worker plugins (with their editor
widget id, roles and default settings), workers that cannot be offered and why, the workflow
document fields and the service nodes the organization may target (admins only)."""

from system.interfaces.api_plugin_interface import ApiPluginInterface
from system.modules import crud_access

from extensions.plugins.workflows.api.v1 import _catalog as catalog
from extensions.plugins.workflows.api.v1 import _common as common


class WorkflowPlugins(ApiPluginInterface):
    def run(self, params=None):
        if (params or {}).get("method") != "GET":
            return {"error": "Use GET"}, 405
        try:
            driver = common.workflows_driver(self.params)
            nodes = driver.nodes()
            discovered = driver.plugins() if hasattr(driver, "plugins") else {"workers": [], "unavailable": []}
            return {
                "plugins": discovered["workers"],
                "unavailable": discovered["unavailable"],
                "workflow_fields": catalog.WORKFLOW_FIELDS,
                "step_flags": catalog.STEP_FLAGS,
                "nodes": nodes,
            }, 200
        except crud_access.AccessDenied as error:
            return {"error": error.message}, error.status
