"""POST /api/v1/crud/Delete/<collection>/<id>; deletes one scoped document."""

from system.interfaces.api_plugin_interface import ApiPluginInterface
from system.modules.documents import run_crud


class Delete(ApiPluginInterface):
    def run(self, params=None):
        return run_crud(self.params, params or {}, "Delete")
