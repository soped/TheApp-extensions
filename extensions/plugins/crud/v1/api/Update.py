"""POST /api/v1/crud/Update/<collection>/<id> with {body: changes}."""

from system.interfaces.api_plugin_interface import ApiPluginInterface
from system.modules.documents import run_crud


class Update(ApiPluginInterface):
    def run(self, params=None):
        return run_crud(self.params, params or {}, "Update")
