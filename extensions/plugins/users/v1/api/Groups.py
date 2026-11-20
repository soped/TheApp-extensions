"""/api/v1/users/Groups/; admin-only organization user groups (GET list, POST create/update/delete)."""

from system.interfaces.api_plugin_interface import ApiPluginInterface
from extensions.plugins.users.api.v1._groups import run_groups


class Groups(ApiPluginInterface):
    def run(self, params=None):
        return run_groups(self.params, params or {})
