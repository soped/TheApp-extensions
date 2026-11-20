"""POST /api/v1/users/Delete/<id>; admin-only scoped deletion."""

from system.interfaces.api_plugin_interface import ApiPluginInterface
from extensions.plugins.users.api.v1._admin import run_users


class Delete(ApiPluginInterface):
    def run(self, params=None):
        return run_users(self.params, params or {}, "Delete")
