"""GET /api/v1/organizations/Read/; returns the admin's own organization."""

from system.interfaces.api_plugin_interface import ApiPluginInterface
from extensions.plugins.organizations.api.v1._admin import run_organization


class Read(ApiPluginInterface):
    def run(self, params=None):
        return run_organization(self.params, params or {}, "Read")
