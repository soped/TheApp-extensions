"""Whole-backend health: API (this plugin answering), database and service runner.

GET /public/v1/health/Status/ -> 200 when everything is ok, 503 otherwise.
Answering at all proves the API loads and serves plugins from the extensions
folder. No secrets or connection details are ever returned.
"""

from system.interfaces.api_plugin_interface import ApiPluginInterface


class Status(ApiPluginInterface):
    ACCESS = "public"
    METHODS = ("GET",)
    DESCRIPTION = "Health of the API, database and service runner"
    CACHE_SECONDS = 0

    def run(self, params=None):
        probe = (self.params.get("drivers") or {}).get("health")
        if probe is None:
            return {"status": "failing", "api": {"ok": True},
                    "database": {"ok": False, "reason": "health probe unavailable"},
                    "service_runner": {"ok": False, "reason": "health probe unavailable"}}, 503
        return probe.report()
