"""POST /api/v1/users/Update/<id>[/credentials]; admin-only scoped update."""

from system.interfaces.api_plugin_interface import ApiPluginInterface
from extensions.plugins.users.api.v1._admin import run_users


class Update(ApiPluginInterface):
    def run(self, params=None):
        return run_users(self.params, params or {}, "Update")
