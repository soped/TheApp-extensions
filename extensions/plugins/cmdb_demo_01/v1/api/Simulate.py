"""The failure simulator's simulate endpoint: fail a random item, a chosen item or a demo scenario.

POST /api/v1/cmdb_demo_01/Simulate/ with one of
  {}                                    fail a random demo item (random mode)
  {item: "srv-db-01"}                   fail that item
  {scenario: "core-switch"|"db-server"|"both-core"}
and optional duration (seconds; 0 = until recovered, default 60, random default 20).
 -> {failed, events, impact, state}

Dependents are set to down or degraded with the impact computation; one event
is written per failed item, and one per recovery when the duration expires.
"""

from extensions.plugins.cmdb_demo_01.api.v1 import _data, _sim, _store
from system.interfaces.api_plugin_interface import ApiPluginInterface


class Simulate(ApiPluginInterface):
    DESCRIPTION = "Inject a mock failure (random item, chosen item or demo scenario) into the CMDB demo"
    METHODS = ("POST",)

    def run(self, params=None, previous_result=None):
        params = params or {}
        return _store.handle(lambda: self._run(params))

    def _run(self, params):
        _store.require_method(params, "POST")
        _store.ensure_seeded(self)
        body = params.get("json") or {}
        if body.get("item") and body.get("scenario"):
            raise _store.Failed("Give an item or a scenario, not both")
        scenario = body.get("scenario")
        if scenario is not None and scenario not in _data.SCENARIOS:
            raise _store.Failed("scenario must be one of " + ", ".join(_data.SCENARIOS))
        random_mode = not body.get("item") and scenario is None
        low, high, default = _sim.RANDOM_DURATION if random_mode else (0, 3600, _sim.DEFAULT_DURATION)
        duration = _store.integer(body.get("duration"), "duration", low, high, default)
        item = _store.find_item(self, body["item"]) if body.get("item") else None
        for key in (_data.SCENARIOS[scenario]["items"] if scenario else ()):
            _store.find_item(self, key)

        def simulate(state, moment, changes):
            _sim.due(self, state, moment, changes)
            if random_mode:
                keys, source = [_sim.random_key(self, state)], "random"
            elif scenario:
                keys, source = list(_data.SCENARIOS[scenario]["items"]), "scenario"
            else:
                keys, source = [item["key"]], "simulator"
            events, _ = _sim.fail(self, state, moment, changes, keys, source=source, duration=duration,
                                  scenario=scenario)
            return {"failed": [event["item"] for event in events], "events": events,
                    "impact": _sim.alert(self, state), "state": _sim.public_state(state, moment)}, 201

        return _sim.locked(self, simulate)
