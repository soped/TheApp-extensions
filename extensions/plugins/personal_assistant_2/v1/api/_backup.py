"""Backups of one space, kept beside the data and downloadable as a file.

A restore never loses anything: the current state is backed up first, records in the backup
get their backed-up values again, and records made after the backup stay.
"""

import hashlib
import json

from extensions.plugins.personal_assistant_2.api.v1 import _core as core
from extensions.plugins.personal_assistant_2.api.v1 import _store as store

KEPT = 14
PART = 100
FORMAT = 1
KINDS = {"tasks": ("task", core.TASKS), "inbox": ("inbox", core.INBOX), "schedule": ("schedule", core.SCHEDULES)}
NOT_A_BACKUP = "This is not a backup file of this app"


def checksum(records):
    return hashlib.sha256(json.dumps(records, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def snapshot(context, space):
    records = {}
    for name, (_, collection) in KINDS.items():
        rows = context.collection(collection).find({"space": space, "deleted": False})
        records[name] = sorted((store.view(row) for row in rows), key=lambda row: row["id"])
    plans = context.collection(core.PLANS).find({"space": space})
    records["plans"] = sorted(({key: value for key, value in plan.items() if key not in ("_id", "organization_id")}
                               for plan in plans), key=lambda plan: plan["date"])
    return records


def create(context, space, reason, identifier=None):
    records = snapshot(context, space)
    identifier = identifier or core.new_id()
    flat = [[name, row] for name, rows in records.items() for row in rows]
    parts = [flat[start:start + PART] for start in range(0, len(flat), PART)]
    for number, part in enumerate(parts):
        context.collection(core.BACKUP_PARTS).update_one(
            {"_id": f"{space}|{identifier}|{number}"},
            {"$set": {"space": space, "backup": identifier, "number": number, "rows": json.dumps(part)}}, upsert=True)
    head = {"id": identifier, "space": space, "reason": reason, "made_at": core.stamp(context.now),
            "counts": {name: len(rows) for name, rows in records.items()}, "parts": len(parts),
            "checksum": checksum(records), "format": FORMAT}
    # The head is written last: a backup that was cut short is never listed.
    context.collection(core.BACKUPS).update_one({"_id": f"{space}|{identifier}"}, {"$set": head}, upsert=True)
    _prune(context, space)
    return _head(head)


def _head(head):
    return {name: head[name] for name in ("id", "reason", "made_at", "counts")}


def daily(context, space):
    """At most one automatic backup per space and day."""
    identifier = "daily-" + context.now.date().isoformat()
    if context.collection(core.BACKUPS).find_one({"_id": f"{space}|{identifier}"}) is None:
        create(context, space, "daily", identifier)


def _prune(context, space):
    heads = sorted(context.collection(core.BACKUPS).find({"space": space}),
                   key=lambda head: head["made_at"], reverse=True)
    for head in heads[KEPT:]:
        context.collection(core.BACKUPS).delete_one({"_id": head["_id"]})
        context.collection(core.BACKUP_PARTS).delete_many({"space": space, "backup": head["id"]})


def listing(context, space):
    heads = context.collection(core.BACKUPS).find({"space": space})
    return [_head(head) for head in sorted(heads, key=lambda head: head["made_at"], reverse=True)]


def read(context, space, identifier):
    head = context.collection(core.BACKUPS).find_one({"_id": f"{space}|{core.check_id(identifier)}"})
    if head is None:
        raise core.Bad("Backup not found", 404)
    records = {name: [] for name in (*KINDS, "plans")}
    parts = context.collection(core.BACKUP_PARTS).find({"space": space, "backup": identifier})
    for part in sorted(parts, key=lambda part: part["number"]):
        for name, row in json.loads(part["rows"]):
            records[name].append(row)
    return dict(_head(head), format=head["format"], checksum=head["checksum"], records=records)


def _fields(kind, row):
    return store.clean(kind, {field: row[field] for field in store.CLEAN[kind] if field in row})


def _plan_is_valid(plan):
    core.parse_day(plan.get("date"))
    return isinstance(plan.get("items"), list) and all(
        isinstance(item, dict) and isinstance(item.get("task"), str) and isinstance(item.get("title"), str)
        and type(item.get("start_minute")) is int and type(item.get("end_minute")) is int
        for item in plan["items"])


def verify(content):
    """The records of a complete, undamaged backup. Everything is checked before any write."""
    records = content.get("records") if isinstance(content, dict) else None
    if (not isinstance(records, dict) or content.get("format") != FORMAT or set(records) != {*KINDS, "plans"}
            or any(not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows)
                   for rows in records.values())):
        raise core.Bad(NOT_A_BACKUP)
    if checksum(records) != content.get("checksum"):
        raise core.Bad("The backup file is damaged or was changed")
    for name, (kind, _) in KINDS.items():
        for row in records[name]:
            core.check_id(row.get("id"))
            core.client_stamp(row.get("created_at"), core.utcnow())
            fields = _fields(kind, row)
            if any(field not in fields for field in store.REQUIRED[kind]):
                raise core.Bad(NOT_A_BACKUP)
    if not all(_plan_is_valid(plan) for plan in records["plans"]):
        raise core.Bad(NOT_A_BACKUP)
    return records


def restore(context, space, content):
    records = verify(content)
    before = create(context, space, "before restore")
    counts = {}
    for name, (kind, collection) in KINDS.items():
        for row in records[name]:
            _restore_record(context, space, kind, collection, row)
        counts[name] = len(records[name])
    today = core.stamp(context.now)[:10]
    for plan in records["plans"]:
        if plan["date"] < today:  # history; today's plan is made again from the restored tasks
            kept = {key: value for key, value in plan.items() if key not in ("_id", "organization_id")}
            context.collection(core.PLANS).update_one(
                {"_id": f"{space}|{plan['date']}"}, {"$set": dict(kept, space=space)}, upsert=True)
    return {"restored": counts, "before": before}


def _restore_record(context, space, kind, collection, row):
    fields = _fields(kind, row)
    created_at = core.client_stamp(row.get("created_at"), context.now)
    stamp = core.stamp(context.now)
    names = (*store.CLEAN[kind], "deleted")

    def change(current):
        current = current or {}
        rev = current.get("rev", 0) + 1
        record = dict(store.NEW[kind], **fields)
        record.update(id=row["id"], space=space, rev=rev, deleted=False, created_at=created_at, updated_at=stamp,
                      conflicts=list(current.get("conflicts") or []), created_op="restore",
                      created_by=current.get("created_by") or context.user, field_rev=dict.fromkeys(names, rev),
                      field_at=dict.fromkeys(names, stamp), field_src=dict.fromkeys(names, "restore"))
        return record, None

    store.write(context.collection(collection), store.key_of(context, space, kind, row["id"]), change)
