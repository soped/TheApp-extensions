"""POST /api/v1/organizations/Update/ with {name}; rename own organization."""

from system.interfaces.api_plugin_interface import ApiPluginInterface
from extensions.plugins.organizations.api.v1._admin import run_organization


class Update(ApiPluginInterface):
    def run(self, params=None):
        return run_organization(self.params, params or {}, "Update")
