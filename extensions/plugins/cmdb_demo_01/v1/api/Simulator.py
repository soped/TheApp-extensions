"""Failure simulator control: state, random-mode start/stop, scenario runs and recovery.

GET  /api/v1/cmdb_demo_01/Simulator/  -> {state, alert}
POST {action: "start", interval?, duration?}   random mode: every interval (>= 10 s) fail a
                                               random item for duration seconds, then recover it
POST {action: "stop"}                          stop random mode (active failures still recover)
POST {action: "scenario", scenario, duration?} run a demo scenario
POST {action: "recover", item?}                recover one simulated failure, or all of them

The simulator runs inside the shared API: every call and every changes-since
poll applies due recoveries and random failures (see _sim).
"""

from extensions.plugins.cmdb_demo_01.api.v1 import _data, _sim, _store
from system.interfaces.api_plugin_interface import ApiPluginInterface


class Simulator(ApiPluginInterface):
    DESCRIPTION = "Start/stop the CMDB demo failure simulator, run scenarios and recover failures"

    def run(self, params=None, previous_result=None):
        params = params or {}
        return _store.handle(lambda: self._run(params))

    def _run(self, params):
        _store.require_method(params, "GET", "POST")
        _store.ensure_seeded(self)
        if params["method"] == "GET":
            _sim.tick(self)
            return self._view(), 200
        body = params.get("json") or {}
        action = body.get("action")
        handlers = {"start": self._start, "stop": self._stop, "scenario": self._scenario, "recover": self._recover}
        if action not in handlers:
            raise _store.Failed("action must be start, stop, scenario or recover")
        handler = handlers[action](body)
        return _sim.locked(self, lambda state, moment, changes: self._apply(handler, state, moment, changes))

    def _apply(self, handler, state, moment, changes):
        _sim.due(self, state, moment, changes)
        events = handler(state, moment, changes) or []
        return {"events": events, "state": _sim.public_state(state, moment), "alert": _sim.alert(self, state)}, 200

    def _view(self):
        state = _store.collection(self, _store.STATE).find_one({"kind": "simulator"}) or dict(_sim.DEFAULT_STATE)
        return {"state": _sim.public_state(state, _store.now()), "alert": _sim.alert(self, state)}

    def _start(self, body):
        interval = _store.integer(body.get("interval"), "interval", *_sim.RANDOM_INTERVAL)
        duration = _store.integer(body.get("duration"), "duration", *_sim.RANDOM_DURATION)

        def start(state, moment, changes):
            schedule = {"running": True, "interval_seconds": interval, "duration_seconds": duration,
                        "next_at": moment}
            state["random"] = changes["random"] = schedule
            return _sim.due(self, state, moment, changes)
        return start

    def _stop(self, body):
        def stop(state, moment, changes):
            schedule = dict(state.get("random") or _sim.DEFAULT_STATE["random"], running=False, next_at=None)
            state["random"] = changes["random"] = schedule
            return []
        return stop

    def _scenario(self, body):
        scenario = body.get("scenario")
        if scenario not in _data.SCENARIOS:
            raise _store.Failed("scenario must be one of " + ", ".join(_data.SCENARIOS))
        duration = _store.integer(body.get("duration"), "duration", 0, 3600, _sim.DEFAULT_DURATION)

        def run(state, moment, changes):
            return _sim.fail(self, state, moment, changes, list(_data.SCENARIOS[scenario]["items"]),
                             source="scenario", duration=duration, scenario=scenario)[0]
        return run

    def _recover(self, body):
        keys = {_store.find_item(self, body["item"])["key"]} if body.get("item") else None

        def recover(state, moment, changes):
            if keys is None and not _sim.failures(state):
                return []
            return _sim.recover(self, state, moment, changes, keys, source="simulator")[0]
        return recover
