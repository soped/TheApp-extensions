"""GET /api/v1/identity/Me/; returns verified identity without credentials."""

from system.interfaces.api_plugin_interface import ApiPluginInterface


class Me(ApiPluginInterface):
    def run(self, params=None):
        return self.params["identity"], 200
