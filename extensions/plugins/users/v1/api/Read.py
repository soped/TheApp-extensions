"""GET /api/v1/users/Read/; admin-only credential-free organization roster."""

from system.interfaces.api_plugin_interface import ApiPluginInterface
from extensions.plugins.users.api.v1._admin import run_users


class Read(ApiPluginInterface):
    def run(self, params=None):
        return run_users(self.params, params or {}, "Read")
