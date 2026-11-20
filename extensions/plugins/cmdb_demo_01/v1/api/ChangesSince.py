"""Changes-since endpoint polled by the live-status widgets every 10 seconds.

GET /api/v1/cmdb_demo_01/ChangesSince/?since=<ISO time>
 -> {since, events (strictly after since, oldest first), cursor, alert, now, poll_seconds, more}
Without since it returns the latest events and a cursor to continue from.
Each poll first applies due simulator work (recoveries, random failures).
"""

from extensions.plugins.cmdb_demo_01.api.v1 import _sim, _store
from system.interfaces.api_plugin_interface import ApiPluginInterface

PAGE = 100
HISTORY = 20
EPOCH = "1970-01-01T00:00:00.000Z"


class ChangesSince(ApiPluginInterface):
    DESCRIPTION = "Status-change events after a timestamp, plus the current alert"
    METHODS = ("GET",)

    def run(self, params=None, previous_result=None):
        params = params or {}
        return _store.handle(lambda: self._run(params))

    def _run(self, params):
        _store.require_method(params, "GET")
        since_text = (params.get("args") or {}).get("since")
        since = _store.parse_time(since_text) if since_text is not None else None
        _store.ensure_seeded(self)
        _sim.tick(self)
        events = _store.collection(self, _store.EVENTS)
        if since is None:
            found = list(events.find({}, sort=[("created_at", -1)], limit=HISTORY))
            found.reverse()
            more = False
        else:
            found = list(events.find({"created_at": {"$gt": since}}, sort=[("created_at", 1)], limit=PAGE + 1))
            more = len(found) > PAGE
            found = found[:PAGE]
        moment = _store.now()
        public = [_store.public_event(doc) for doc in found]
        # Cursors only ever come from event times (strictly increasing) or the caller's own since;
        # with no events yet, start at the epoch so an event written in this same millisecond is not skipped.
        cursor = public[-1]["created_at"] if public else (_store.iso(since) if since else EPOCH)
        return {"since": _store.iso(since) if since else None, "events": public, "cursor": cursor, "more": more,
                "alert": _sim.alert(self), "now": _store.iso(moment), "poll_seconds": _store.POLL_SECONDS}, 200
