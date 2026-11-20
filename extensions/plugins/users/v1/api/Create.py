"""POST /api/v1/users/Create/; creates a human or service account in the admin's organization."""

from system.interfaces.api_plugin_interface import ApiPluginInterface
from extensions.plugins.users.api.v1._admin import run_users


class Create(ApiPluginInterface):
    def run(self, params=None):
        return run_users(self.params, params or {}, "Create")
