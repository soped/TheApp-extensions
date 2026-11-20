"""Demo data: GET counts; POST {action: "reset"} (administrators) wipes and reseeds the mock data.

Only this organization's cmdb_demo_01_* collections are touched, through the
organization-scoped tenant database; nothing else in the app database is read
or changed. The data is seeded automatically on first use.
"""

from extensions.plugins.cmdb_demo_01.api.v1 import _store
from system.interfaces.api_plugin_interface import ApiPluginInterface


class Seed(ApiPluginInterface):
    DESCRIPTION = "Counts of the CMDB demo mock data; administrators can wipe and reseed it"

    def run(self, params=None, previous_result=None):
        params = params or {}
        return _store.handle(lambda: self._run(params))

    def _run(self, params):
        _store.require_method(params, "GET", "POST")
        if params["method"] == "GET":
            seeded = _store.ensure_seeded(self)
            return {"seeded_now": seeded, "counts": _store.counts(self)}, 200
        if (params.get("json") or {}).get("action") != "reset":
            raise _store.Failed('action must be "reset"')
        if not _store.is_admin(self):
            raise _store.Failed("Administrator privileges required to reset the demo data", 403)
        return {"reset": True, "counts": _store.seed(self, wipe=True)}, 200
