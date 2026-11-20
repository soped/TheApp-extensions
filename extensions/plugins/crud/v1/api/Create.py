"""POST /api/v1/crud/Create/<collection>/ with {body: document}."""

from system.interfaces.api_plugin_interface import ApiPluginInterface
from system.modules.documents import run_crud


class Create(ApiPluginInterface):
    def run(self, params=None):
        return run_crud(self.params, params or {}, "Create")
