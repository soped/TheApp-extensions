"""Failure simulator: injects and recovers mock failures and writes status-change events.

App modules publish only API plugins and widgets (no service-runner workers),
so the simulator is driven by the API: its state document stores the active
failures and the random-mode schedule, and ``tick`` applies whatever is due
(recoveries whose duration expired, the next random failure). Every
changes-since poll and every simulator call ticks, so failures happen and
recover while anyone has the app open. A short lease on the state document
serializes ticks and commands across concurrent requests.

Statuses: each item keeps ``base_status`` (seeded or manually edited) and a
derived ``status``. Recompute marks failed items down, applies the impact
evaluation (``_impact``) to their dependents, and restores the base status of
everything else. Only the demo collections are touched.
"""

import random
from uuid import uuid4

from extensions.plugins.cmdb_demo_01.api.v1 import _data, _impact, _store

LEASE_SECONDS = 10
DEFAULT_DURATION = 60          # seconds a scenario/single failure lasts; 0 = until recovered
RANDOM_INTERVAL = (10, 3600, 30)   # min, max, default seconds between random failures
RANDOM_DURATION = (5, 3600, 20)    # min, max, default seconds a random failure lasts
DEFAULT_STATE = {"failures": [],
                 "random": {"running": False, "interval_seconds": RANDOM_INTERVAL[2],
                            "duration_seconds": RANDOM_DURATION[2], "next_at": None}}


class Busy(_store.Failed):
    def __init__(self):
        super().__init__("The simulator is busy with another change; retry in a moment", 409)


# ---- state and lease -----------------------------------------------------------------------------

def _state(plugin):
    return _store.collection(plugin, _store.STATE)


def acquire(plugin, moment):
    """Claim the simulator lease; returns the state document or None if another request holds it."""
    state = _state(plugin)
    state.find_one_and_update({"kind": "simulator"}, {"$setOnInsert": DEFAULT_STATE}, upsert=True)
    return state.find_one_and_update(
        {"kind": "simulator", "$or": [{"lease_until": None}, {"lease_until": {"$lt": moment}}]},
        {"$set": {"lease_until": _store.plus(moment, LEASE_SECONDS)}}, return_document=True)


def release(plugin, changes=None):
    _state(plugin).update_one({"kind": "simulator"}, {"$set": dict(changes or {}, lease_until=None)})


def locked(plugin, action, wait=True):
    """Run ``action(state, moment)`` under the lease; raise Busy (or return None if not wait)."""
    moment = _store.now()
    state = acquire(plugin, moment)
    if state is None:
        if wait:
            raise Busy()
        return None
    changes = {}
    try:
        return action(state, moment, changes)
    finally:
        release(plugin, changes)


def failures(state):
    return [dict(item) for item in state.get("failures") or []]


# ---- recompute -----------------------------------------------------------------------------------

def snapshot(plugin):
    documents = _store.items(plugin)
    return documents, {doc["key"]: doc for doc in documents}, {doc["_id"]: doc for doc in documents}


def failed_keys(active, documents):
    """Simulated failures plus items whose own (manually edited) status is down."""
    keys = {failure["key"] for failure in active}
    keys.update(doc["key"] for doc in documents if doc.get("base_status") == "down")
    return keys


def impact(plugin, keys, docs_by_key=None, docs_by_id=None):
    """Impact report for failing ``keys`` (the impact plugin's computation)."""
    if docs_by_key is None:
        _, docs_by_key, docs_by_id = snapshot(plugin)
    failed_docs = [docs_by_key[key] for key in sorted(keys) if key in docs_by_key]
    evaluation, truncated = _impact.analyze(_store.collection(plugin, _store.RELATIONS), docs_by_id,
                                            [doc["_id"] for doc in failed_docs])
    return _store.describe(failed_docs, evaluation, docs_by_key, _store.teams(plugin), truncated), evaluation


def recompute(plugin, active, moment):
    """Write derived statuses for the given active failures; returns (changed items, report)."""
    documents, docs_by_key, docs_by_id = snapshot(plugin)
    keys = failed_keys(active, documents)
    report, evaluation = impact(plugin, keys, docs_by_key, docs_by_id)
    team_map = _store.teams(plugin)
    changed = []
    items = _store.collection(plugin, _store.ITEMS)
    for doc in documents:
        base = doc.get("base_status", doc.get("status"))
        if doc["key"] in keys:
            status, cause = "down", None
        elif doc["key"] in evaluation:
            status, cause = evaluation[doc["key"]]["state"], evaluation[doc["key"]]["state"]
        else:
            status, cause = base, None
        impacted_by = sorted(keys) if cause else []
        if status != doc.get("status") or cause != doc.get("impact") or impacted_by != list(doc.get("impacted_by") or []):
            items.update_one({"_id": doc["_id"]}, {"$set": {"status": status, "impact": cause,
                                                            "impacted_by": impacted_by, "updated_at": moment}})
            if status != doc.get("status"):
                changed.append({"key": doc["key"], "name": doc.get("name") or doc["key"],
                                "old_status": doc.get("status"), "new_status": status,
                                "owner": doc.get("owner"), "owner_name": _store.team_name(team_map, doc.get("owner")),
                                "environment": doc.get("environment")})
    return changed, report


# ---- events --------------------------------------------------------------------------------------

def event_time(plugin, moment):
    """Strictly increasing event times, so 'after timestamp' cursors never skip an event."""
    last = _store.collection(plugin, _store.EVENTS).find_one({}, sort=[("created_at", -1)])
    if last is not None and _store.utc(last["created_at"]) >= moment:
        return _store.plus(_store.utc(last["created_at"]), 0.001)
    return moment


def write_event(plugin, moment, *, kind, source, item, old_status, new_status, affected, report, scenario=None):
    team_map = _store.teams(plugin)
    document = {
        "kind": kind, "source": source, "item": item["key"], "item_name": item.get("name") or item["key"],
        "old_status": old_status, "new_status": new_status, "owner": item.get("owner"),
        "owner_name": _store.team_name(team_map, item.get("owner")), "environment": item.get("environment"),
        "scenario": scenario, "severity": report["severity"],
        "affected": [entry for entry in affected if entry["key"] != item["key"]],
        "created_at": event_time(plugin, moment),
    }
    if kind == "recovery":
        restored = len(document["affected"])
        document["summary"] = (f"{item['key']} recovered, {restored} item{'s' if restored != 1 else ''} restored"
                               + (f"; still active: {report['summary']}" if report["failed"] else ""))
    else:
        document["summary"] = report["summary"]
    result = _store.collection(plugin, _store.EVENTS).insert_one(document)
    document["_id"] = result.inserted_id
    return _store.public_event(document)


# ---- operations (run under the lease) -------------------------------------------------------------

def fail(plugin, state, moment, changes, keys, *, source, duration, scenario=None):
    """Fail items one by one, each with its own event; returns (events, report)."""
    active = failures(state)
    _, docs_by_key, _ = snapshot(plugin)
    already = {failure["key"] for failure in active}
    new = [key for key in keys if key not in already and docs_by_key[key].get("base_status") != "down"]
    if not new:
        raise _store.Failed("Already down: " + ", ".join(keys), 409)
    events, report = [], None
    for key in new:
        active.append({"id": uuid4().hex, "key": key, "source": source, "scenario": scenario,
                       "started_at": moment, "recover_at": _store.plus(moment, duration) if duration else None})
        changes["failures"] = active
        old = docs_by_key[key].get("status")
        changed, report = recompute(plugin, active, moment)
        events.append(write_event(plugin, moment, kind="failure", source=source, item=docs_by_key[key],
                                  old_status=old, new_status="down", affected=changed, report=report,
                                  scenario=scenario))
    changes["failures"] = active
    state["failures"] = active
    return events, report


def recover(plugin, state, moment, changes, keys=None, source="simulator"):
    """Recover the given (or all) simulated failures, one event per recovered item."""
    active = failures(state)
    targets = [failure for failure in active if keys is None or failure["key"] in keys]
    if keys is not None and not targets:
        raise _store.Failed("Not failed by the simulator: " + ", ".join(sorted(keys)), 404)
    events, report = [], None
    for failure in targets:
        active = [item for item in active if item["id"] != failure["id"]]
        changes["failures"] = active
        _, docs_by_key, _ = snapshot(plugin)
        item = docs_by_key.get(failure["key"])
        changed, report = recompute(plugin, active, moment)
        if item is None:
            continue
        restored = _store.collection(plugin, _store.ITEMS).find_one({"_id": item["_id"]})
        events.append(write_event(plugin, moment, kind="recovery", source=source, item=item, old_status="down",
                                  new_status=restored.get("status"), affected=changed, report=report,
                                  scenario=failure.get("scenario")))
    changes["failures"] = active
    state["failures"] = active
    return events, report


def random_key(plugin, state):
    active = {failure["key"] for failure in failures(state)}
    candidates = [doc["key"] for doc in _store.items(plugin, {"demo": True})
                  if doc["key"] not in active and doc.get("base_status") != "down"]
    if not candidates:
        raise _store.Failed("Every demo item is already down", 409)
    return random.choice(candidates)


def due(plugin, state, moment, changes):
    """Apply expired recoveries and the next scheduled random failure."""
    events = []
    expired = {failure["key"] for failure in failures(state)
               if failure.get("recover_at") is not None and _store.utc(failure["recover_at"]) <= moment}
    if expired:
        events += recover(plugin, state, moment, changes, expired, source="simulator")[0]
    schedule = dict(state.get("random") or DEFAULT_STATE["random"])
    if schedule.get("running") and (schedule.get("next_at") is None or _store.utc(schedule["next_at"]) <= moment):
        schedule["next_at"] = _store.plus(moment, schedule["interval_seconds"])
        changes["random"] = schedule
        state["random"] = schedule
        try:
            key = random_key(plugin, state)
        except _store.Failed:
            key = None
        if key is not None:
            events += fail(plugin, state, moment, changes, [key], source="random",
                           duration=schedule["duration_seconds"])[0]
    return events


def tick(plugin):
    """Apply due simulator work if no other request is doing so; never blocks a poll."""
    result = locked(plugin, lambda state, moment, changes: due(plugin, state, moment, changes), wait=False)
    return result or []


# ---- views ---------------------------------------------------------------------------------------

def public_state(state, moment):
    schedule = state.get("random") or DEFAULT_STATE["random"]
    return {
        "failures": [{"id": failure["id"], "item": failure["key"], "source": failure.get("source"),
                      "scenario": failure.get("scenario"), "started_at": _store.iso(failure["started_at"]),
                      "recover_at": _store.iso(failure.get("recover_at"))} for failure in failures(state)],
        "random": {"running": bool(schedule.get("running")), "interval_seconds": schedule.get("interval_seconds"),
                   "duration_seconds": schedule.get("duration_seconds"), "next_at": _store.iso(schedule.get("next_at"))},
        "scenarios": [{"id": key, "title": value["title"], "items": list(value["items"])}
                      for key, value in _data.SCENARIOS.items()],
        "limits": {"interval_seconds": list(RANDOM_INTERVAL[:2]), "duration_seconds": list(RANDOM_DURATION[:2]),
                   "poll_seconds": _store.POLL_SECONDS},
        "now": _store.iso(moment),
    }


def alert(plugin, state=None):
    """The current alert for all active failures (simulated and manual), or None when all is well."""
    state = state if state is not None else (_state(plugin).find_one({"kind": "simulator"}) or DEFAULT_STATE)
    documents, docs_by_key, docs_by_id = snapshot(plugin)
    active = failures(state)
    keys = failed_keys(active, documents)
    if not keys:
        return None
    report, _ = impact(plugin, keys, docs_by_key, docs_by_id)
    started = [_store.utc(failure["started_at"]) for failure in active]
    started += [_store.utc(docs_by_key[key].get("updated_at")) for key in keys
                if key not in {failure["key"] for failure in active} and docs_by_key[key].get("updated_at")]
    sources = {failure["key"]: failure.get("source") for failure in active}
    for entry in report["failed"]:
        entry["source"] = sources.get(entry["key"], "manual")
    return dict(report, active=True, started_at=_store.iso(min(started)) if started else None)
