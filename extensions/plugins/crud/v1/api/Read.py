"""GET|POST /api/v1/crud/Read/<collection>[/<id>] with query/projection/limit/skip."""

from system.interfaces.api_plugin_interface import ApiPluginInterface
from system.modules.documents import run_crud


class Read(ApiPluginInterface):
    def run(self, params=None):
        return run_crud(self.params, params or {}, "Read")
