"""Status-change event log: GET /api/v1/cmdb_demo_01/Events/[?item=<key>&limit=50] (newest first).

Each event stores the item, old/new status, timestamp, affected items and owner team.
"""

from extensions.plugins.cmdb_demo_01.api.v1 import _store
from system.interfaces.api_plugin_interface import ApiPluginInterface


class Events(ApiPluginInterface):
    DESCRIPTION = "CMDB demo status-change log with affected items and owner teams"
    METHODS = ("GET",)

    def run(self, params=None, previous_result=None):
        params = params or {}
        return _store.handle(lambda: self._run(params))

    def _run(self, params):
        _store.require_method(params, "GET")
        args = params.get("args") or {}
        limit = _store.integer(args.get("limit"), "limit", 1, 200, 50)
        _store.ensure_seeded(self)
        query = {}
        if args.get("item"):
            key = _store.find_item(self, args["item"])["key"]
            query = {"$or": [{"item": key}, {"affected.key": key}]}
        found = _store.collection(self, _store.EVENTS).find(query, sort=[("created_at", -1)], limit=limit)
        return {"events": [_store.public_event(doc) for doc in found]}, 200
