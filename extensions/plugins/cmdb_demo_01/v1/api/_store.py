"""Shared storage, serialization and summary helpers for the cmdb_demo_01 API plugins.

All data lives in the organization-scoped tenant database given to plugins
(``self.params['drivers']['mongodb']``); the driver adds the organization to
every query and document. Collections are prefixed ``cmdb_demo_01_`` and only
ever contain the made-up CMDB demo 01 mock data.
"""

import logging
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from bson.errors import InvalidId

from extensions.plugins.cmdb_demo_01.api.v1 import _data
from system.modules import crud_access

PREFIX = "cmdb_demo_01_"
ITEMS, TEAMS, RELATIONS, EVENTS, STATE = (PREFIX + name for name in ("items", "teams", "relations", "events", "state"))
COLLECTIONS = (ITEMS, TEAMS, RELATIONS, EVENTS, STATE)
STATUSES = ("operational", "degraded", "down", "maintenance")
TYPES = ("switch", "server", "database", "application")
RELATION_TYPES = ("depends", "owns", "redundant")
POLL_SECONDS = 10
LOG = logging.getLogger(__name__)
AccessDenied = crud_access.AccessDenied


class Failed(Exception):
    """An expected request failure with an HTTP status."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def handle(run):
    """Map expected failures to JSON (body, status); programming errors still propagate."""
    try:
        return run()
    except Failed as error:
        return {"error": error.message}, error.status
    except AccessDenied as error:
        return {"error": error.message}, error.status


def require_method(params, *allowed):
    if params.get("method") not in allowed:
        raise Failed(f"Use {' or '.join(allowed)}", 405)


def collection(plugin, name):
    database = plugin.params.get("drivers", {}).get("mongodb")
    if database is None:
        raise Failed("MongoDB driver not available", 500)
    return database.get_collection(name)


def is_admin(plugin):
    return ((plugin.params.get("identity") or {}).get("properties") or {}).get("user_type") == "admin"


def now():
    # MongoDB keeps milliseconds; truncating keeps changes-since cursors exact.
    moment = datetime.now(timezone.utc)
    return moment.replace(microsecond=moment.microsecond // 1000 * 1000)


def utc(moment):
    if moment is None:
        return None
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment.astimezone(timezone.utc)


def iso(moment):
    moment = utc(moment)
    if moment is None:
        return None
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def parse_time(value, label="since"):
    if not isinstance(value, str) or not value.strip():
        raise Failed(f"{label} must be an ISO 8601 time")
    try:
        moment = datetime.fromisoformat(value.strip().replace("Z", "+00:00").replace("z", "+00:00"))
    except ValueError as error:
        raise Failed(f"{label} must be an ISO 8601 time") from error
    return utc(moment)


def integer(value, label, low, high, default):
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        raise Failed(f"{label} must be a whole number")
    try:
        number = int(value)
    except (TypeError, ValueError) as error:
        raise Failed(f"{label} must be a whole number") from error
    if number != value and not isinstance(value, str):
        raise Failed(f"{label} must be a whole number")
    if not low <= number <= high:
        raise Failed(f"{label} must be between {low} and {high}")
    return number


def text(value, label, limit, required=False):
    if value is None:
        if required:
            raise Failed(f"{label} is required")
        return ""
    if not isinstance(value, str):
        raise Failed(f"{label} must be text")
    value = value.strip()
    if required and not value:
        raise Failed(f"{label} is required")
    if len(value) > limit:
        raise Failed(f"{label} is limited to {limit} characters")
    return value


# ---- seeding -------------------------------------------------------------------------------------

def seed(plugin, wipe=False):
    """Load the canonical mock dataset into this organization's demo collections."""
    collections = {name: collection(plugin, name) for name in COLLECTIONS}
    if wipe:
        for name in COLLECTIONS:
            collections[name].delete_many({})
    moment = now()
    teams = collections[TEAMS]
    team_ids = {team["key"]: teams.insert_one(dict(team, demo=True)).inserted_id for team in _data.TEAMS}
    items = collections[ITEMS]
    item_ids = {}
    for item in _data.ITEMS:
        document = dict(item, base_status=item["status"], impact=None, impacted_by=[], demo=True,
                        updated_at=moment)
        item_ids[item["key"]] = items.insert_one(document).inserted_id
    ids = {**team_ids, **item_ids}
    relations = collections[RELATIONS]
    for relation in _data.relations():
        relations.insert_one(dict(relation, source_id=ids[relation["source"]], target_id=ids[relation["target"]],
                                  demo=True, created_at=moment))
    for name, keys in ((ITEMS, ["key"]), (TEAMS, ["key"]), (RELATIONS, ["source_id"]), (RELATIONS, ["target_id"]),
                       (EVENTS, ["created_at"]), (STATE, ["kind"])):
        collections[name].create_index([(key, 1) for key in keys])
    collections[STATE].update_one({"kind": "seed"}, {"$set": {"seeded_at": moment}}, upsert=True)
    return counts(plugin)


def ensure_seeded(plugin):
    """Seed once per organization on first use, so the demo works out of the box."""
    state = collection(plugin, STATE)
    if state.find_one({"kind": "seed"}) is not None:
        return False
    # Claim the seed marker atomically; only the claimant loads the data.
    previous = state.find_one_and_update({"kind": "seed"}, {"$setOnInsert": {"seeded_at": now()}},
                                         upsert=True, return_document=False)
    if previous is not None:
        return False
    if collection(plugin, ITEMS).count_documents({}, limit=1):
        return False
    seed(plugin)
    return True


def counts(plugin):
    return {"items": collection(plugin, ITEMS).count_documents({}),
            "teams": collection(plugin, TEAMS).count_documents({}),
            "relations": collection(plugin, RELATIONS).count_documents({}),
            "events": collection(plugin, EVENTS).count_documents({})}


# ---- lookups and serialization -------------------------------------------------------------------

def teams(plugin):
    return {doc["key"]: doc for doc in collection(plugin, TEAMS).find({}, sort=[("key", 1)])}


def items(plugin, query=None):
    return list(collection(plugin, ITEMS).find(query or {}, sort=[("key", 1)]))


def find_item(plugin, reference, label="item"):
    """An item by key (e.g. sw-core-01) or id; 404 when it does not exist."""
    reference = text(reference, label, 120, required=True)
    query = {"key": reference}
    if len(reference) == 24:
        try:
            query = {"$or": [{"key": reference}, {"_id": ObjectId(reference)}]}
        except InvalidId:
            pass
    found = collection(plugin, ITEMS).find_one(query)
    if found is None:
        raise Failed(f"Unknown {label}: {reference}", 404)
    return found


def find_end(plugin, reference, label):
    """A relation end: an item or a team, by key; 404 when neither exists."""
    reference = text(reference, label, 120, required=True)
    item = collection(plugin, ITEMS).find_one({"key": reference})
    if item is not None:
        return item, "item"
    team = collection(plugin, TEAMS).find_one({"key": reference})
    if team is not None:
        return team, "team"
    raise Failed(f"Unknown {label}: {reference} does not exist", 404)


def team_name(team_map, key):
    team = team_map.get(key)
    return team["name"] if team else key


def public_item(document, team_map):
    return {
        "id": str(document["_id"]), "key": document["key"], "name": document.get("name") or document["key"],
        "type": document.get("type"), "subtype": document.get("subtype") or "",
        "owner": document.get("owner"), "owner_name": team_name(team_map, document.get("owner")),
        "environment": document.get("environment"), "status": document.get("status"),
        "base_status": document.get("base_status", document.get("status")), "impact": document.get("impact"),
        "impacted_by": list(document.get("impacted_by") or []), "notes": document.get("notes") or "",
        "ip": document.get("ip") or "", "updated_at": iso(document.get("updated_at")),
    }


def public_team(document):
    return {"id": str(document["_id"]), "key": document["key"], "name": document["name"],
            "scope": document.get("scope", "")}


def public_event(document):
    return {
        "id": str(document["_id"]), "kind": document["kind"], "source": document.get("source"),
        "item": document["item"], "item_name": document.get("item_name", document["item"]),
        "old_status": document.get("old_status"), "new_status": document.get("new_status"),
        "owner": document.get("owner"), "owner_name": document.get("owner_name"),
        "environment": document.get("environment"), "scenario": document.get("scenario"),
        "severity": document.get("severity"), "summary": document.get("summary", ""),
        "affected": list(document.get("affected") or []), "created_at": iso(document["created_at"]),
    }


# ---- impact summaries ----------------------------------------------------------------------------

def affected_entry(document, team_map, evaluation):
    return {"key": document["key"], "name": document.get("name") or document["key"], "type": document.get("type"),
            "environment": document.get("environment"), "owner": document.get("owner"),
            "owner_name": team_name(team_map, document.get("owner")), "status": evaluation["state"],
            "depth": evaluation["depth"], "via": evaluation["via"], "covered": evaluation["covered"]}


def describe(failed_docs, evaluation, docs_by_key, team_map, truncated=False):
    """Impact report for failed items: down/degraded lists with owners, severity and the banner line."""
    entries = sorted((affected_entry(docs_by_key[key], team_map, value) for key, value in evaluation.items()
                      if key in docs_by_key), key=lambda entry: (entry["depth"], entry["key"]))
    down = [entry for entry in entries if entry["status"] == "down"]
    degraded = [entry for entry in entries if entry["status"] == "degraded"]
    owners = {}
    for entry in entries:
        owner = owners.setdefault(entry["owner"], {"key": entry["owner"], "name": entry["owner_name"],
                                                   "down": 0, "degraded": 0})
        owner[entry["status"]] += 1
    covering = [{"item": entry["key"], **cover} for entry in degraded for cover in entry["covered"]]
    severity = "outage" if down else "degraded" if degraded else "none"
    failed = [{"key": doc["key"], "name": doc.get("name") or doc["key"], "type": doc.get("type"),
               "environment": doc.get("environment"), "owner": doc.get("owner"),
               "owner_name": team_name(team_map, doc.get("owner"))} for doc in failed_docs]
    environments = sorted({entry["environment"] for entry in entries + failed if entry["environment"]})
    return {
        "failed": failed, "affected": entries, "down": down, "degraded": degraded,
        "counts": {"down": len(down), "degraded": len(degraded), "affected": len(entries)},
        "owners": sorted(owners.values(), key=lambda owner: owner["name"] or ""),
        "environments": environments, "prod_hit": "prod" in environments,
        "severity": severity, "failover": bool(covering), "covering": covering, "truncated": truncated,
        "summary": summary(failed, down, degraded, bool(covering)),
    }


def summary(failed, down, degraded, failover):
    """Banner one-liner, e.g. 'sw-core-01 down, failover active, 10 items degraded, Platform Team'."""
    if not failed:
        return "All systems operational"
    names = " + ".join(entry["key"] for entry in failed) + " down"
    owners = ", ".join(dict.fromkeys(entry["owner_name"] for entry in failed if entry["owner_name"]))

    def plural(count, word):
        return f"{count} item{'s' if count != 1 else ''} {word}"

    if down:
        parts = [names, "outage", plural(len(down), "down")]
        if degraded:
            parts.append(f"{len(degraded)} degraded")
    elif degraded:
        parts = [names, "failover active" if failover else "degraded", plural(len(degraded), "degraded")]
    else:
        parts = [names, "no dependents affected"]
    return ", ".join(parts + ([owners] if owners else []))


def plus(moment, seconds):
    return moment + timedelta(seconds=seconds)
