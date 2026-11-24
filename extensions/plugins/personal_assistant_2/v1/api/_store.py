"""Tasks, inbox, schedule and settings: one write path for the REST plugins and for sync.

Every change is an operation. Applying the same operation twice changes nothing, so a device
can safely resend after a lost answer. When two devices change the same field, one value is
kept and the other is stored on the record as a conflict the user can still choose.
"""

import re

from extensions.plugins.personal_assistant_2.api.v1 import _core as core

STATUS = ("open", "started", "done")
RANK = {"open": 0, "started": 1, "done": 2}
COLLECTION = {"task": core.TASKS, "inbox": core.INBOX, "schedule": core.SCHEDULES, "settings": core.SETTINGS}
COLOUR_MODES = ("default", "protanopia", "deuteranopia", "tritanopia")
ENERGY = ("low", "normal", "high")
MOTION = ("system", "reduce")
DEFAULT_SETTINGS = {"colour_mode": "default", "energy": "normal", "motion": "system"}
TEXT_LIMIT = 10000
HIDDEN = ("_id", "organization_id", "field_rev", "field_at", "field_src", "created_op")


# ---------------------------------------------------------------- field validation

def _text(value, label, limit):
    if not isinstance(value, str) or not value.strip():
        raise core.Bad(f"{label} is required")
    value = " ".join(value.split())
    if len(value) > limit:
        raise core.Bad(f"{label} can be at most {limit} characters")
    return value


def _deadline(value):
    if value in (None, ""):
        return None
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?", value):
        raise core.Bad("deadline must be YYYY-MM-DD or YYYY-MM-DDTHH:MM")
    core.parse_day(value[:10])
    if len(value) > 10:
        core.minutes(value[11:], "deadline time")
    return value


def _choice(value, allowed, label):
    if value not in allowed:
        raise core.Bad(f"{label} must be one of: {', '.join(allowed)}")
    return value


def _duration(value):
    if type(value) is not int or not 1 <= value <= 1440:
        raise core.Bad("duration must be 1 to 1440 minutes")
    return value


def _flag(value):
    if type(value) is not bool:
        raise core.Bad("must_do must be true or false")
    return value


def _when(label):
    return lambda value: None if value in (None, "") else core.stamp(core.parse_stamp(value, label))


CLEAN = {
    "task": {
        "title": lambda value: _text(value, "title", 500),
        "context": lambda value: _choice(value, ("work", "private"), "context"),
        "duration": _duration, "deadline": _deadline, "must_do": _flag,
        "status": lambda value: _choice(value, STATUS, "status"),
        "started_at": _when("started_at"), "finished_at": _when("finished_at"),
        "parent": lambda value: None if value in (None, "") else core.check_id(value, "parent"),
    },
    "inbox": {
        "text": lambda value: _text(value, "text", TEXT_LIMIT),
        "source": lambda value: _choice(value, ("text", "voice"), "source"),
        "status": lambda value: _choice(value, ("inbox", "sorted"), "status"),
        "captured_at": _when("captured_at"),
    },
    "schedule": {"value": core.clean_schedule},
    "settings": {
        "colour_mode": lambda value: _choice(value, COLOUR_MODES, "colour_mode"),
        "energy": lambda value: _choice(value, ENERGY, "energy"),
        "motion": lambda value: _choice(value, MOTION, "motion"),
    },
}
NEW = {
    "task": {"context": "private", "duration": 30, "deadline": None, "must_do": False, "status": "open",
             "started_at": None, "finished_at": None, "parent": None},
    "inbox": {"source": "text", "status": "inbox"},
    "schedule": {}, "settings": DEFAULT_SETTINGS,
}
REQUIRED = {"task": ("title",), "inbox": ("text",), "schedule": ("value",), "settings": ()}


def clean(kind, fields):
    if not isinstance(fields, dict):
        raise core.Bad("fields must be an object")
    unknown = set(fields) - set(CLEAN[kind])
    if unknown:
        raise core.Bad("Unknown fields: " + ", ".join(sorted(map(str, unknown))))
    return {name: CLEAN[kind][name](value) for name, value in fields.items()}


# ---------------------------------------------------------------- records

def key_of(context, space, kind, identifier):
    if kind == "schedule":
        return f"{space}|schedule|schedule"
    if kind == "settings":
        return f"{context.personal_space()['id']}|settings|settings"
    return f"{space}|{kind}|{core.check_id(identifier)}"


def view(record):
    return {name: value for name, value in record.items() if name not in HIDDEN}


def write(collection, key, change):
    """Optimistic update: change(current) -> (new record or None, result)."""
    for _ in range(8):
        current = collection.find_one({"_id": key})
        record, result = change(current)
        if record is None:
            return result
        record = {name: value for name, value in record.items() if name not in ("_id", "organization_id")}
        if current is None:
            written = collection.update_one({"_id": key}, {"$setOnInsert": record}, upsert=True).upserted_id
        else:
            written = collection.update_one({"_id": key, "rev": current["rev"]}, {"$set": record}).matched_count
        if written:
            return result
    raise core.Busy()


def _conflict(op, field, kept, other, number):
    return {"id": f"{op['op_id']}-{number}"[:80], "field": field, "kept": kept, "other": other, "at": op["at"]}


def _set(record, name, value, op, device):
    record[name] = value
    record["field_rev"] = dict(record["field_rev"], **{name: record["rev"]})
    record["field_at"] = dict(record["field_at"], **{name: op["at"]})
    record["field_src"] = dict(record["field_src"], **{name: device})


def _status_times(record, op):
    if record["status"] == "started":
        record["started_at"] = record.get("started_at") or op["at"]
        record["finished_at"] = None
    elif record["status"] == "done":
        record["finished_at"] = record.get("finished_at") or op["at"]
    else:
        record["started_at"] = record["finished_at"] = None


def _concurrent(record, name, op, device):
    """Someone else changed this field after the device last saw the record."""
    base = op.get("base_rev")
    return (base is not None and record["field_rev"].get(name, 0) > base
            and record["field_src"].get(name) != device)


def _merge(current, fields, op, device, kind):
    record = dict(current, rev=current["rev"] + 1, updated_at=op["at"], conflicts=list(current.get("conflicts") or []))
    found = []
    if record.get("deleted"):
        record["deleted"] = False
        if record["field_src"].get("deleted") != device:
            found.append(_conflict(op, "deleted", False, True, len(found)))
        _set(record, "deleted", False, op, device)
    for name, value in fields.items():
        if current.get(name) == value:
            continue
        if _concurrent(current, name, op, device):
            mine = op["at"] > current["field_at"].get(name, "")
            if kind == "task" and name == "status":
                mine = RANK[value] > RANK[current["status"]]  # finished work is never undone by a race
            found.append(_conflict(op, name, value if mine else current.get(name),
                                   current.get(name) if mine else value, len(found)))
            if not mine:
                continue
        _set(record, name, value, op, device)
        if kind == "task" and name == "status":
            _status_times(record, op)
    for name in ("started_at", "finished_at"):  # explicit times win over the derived ones
        if kind == "task" and name in fields and record["field_rev"].get(name) == record["rev"]:
            record[name] = fields[name]
    record["conflicts"] += found
    return record, found


def _parent(context, space, kind, identifier, fields):
    """Check a sub-task's parent. A parent that is gone never costs the user the task."""
    if kind != "task" or not fields.get("parent"):
        return fields, None
    tasks = context.collection(core.TASKS)
    parent = tasks.find_one({"_id": f"{space}|task|{fields['parent']}", "deleted": False})
    if parent is None:
        return dict(fields, parent=None), "The task it belonged to is gone, so it is kept as its own task"
    if parent["id"] == identifier or parent.get("parent"):
        raise core.Bad("A sub-task cannot have sub-tasks of its own")
    if tasks.find_one({"space": space, "parent": identifier, "deleted": False}):
        raise core.Bad("A task with sub-tasks cannot become a sub-task")
    return fields, None


def _create(context, space, op, device, kind, key):
    fields = clean(kind, op.get("fields"))
    missing = [name for name in REQUIRED[kind] if name not in fields]
    if missing:
        raise core.Bad(f"{missing[0]} is required")
    fields, message = _parent(context, space, kind, op["id"], fields)
    if kind == "inbox":
        fields["captured_at"] = core.client_stamp(fields.get("captured_at") or op["at"], context.now)

    def change(current):
        if current is not None:
            if current.get("created_op") == op["op_id"]:
                return None, ("applied", current, None)
            raise core.Bad("That id is already used", 409)
        record = dict(NEW[kind], **fields)
        record.update(id=op["id"], space=space, rev=1, deleted=False, conflicts=[], created_at=op["at"],
                      updated_at=op["at"], created_by=context.user, created_op=op["op_id"])
        record.update(field_rev={name: 1 for name in CLEAN[kind]}, field_at={name: op["at"] for name in CLEAN[kind]},
                      field_src={name: device for name in CLEAN[kind]})
        if kind == "task":
            _status_times(record, op)
            record.update({name: fields[name] for name in ("started_at", "finished_at") if name in fields})
        return record, ("merged" if message else "applied", record, message)

    return write(context.collection(COLLECTION[kind]), key, change)


def _update(context, space, op, device, kind, key):
    fields = clean(kind, op.get("fields"))
    if not fields:
        raise core.Bad("Nothing to change")
    fields, message = _parent(context, space, kind, op["id"], fields)

    def change(current):
        if current is None:
            if kind not in ("schedule", "settings"):
                raise core.Bad(f"{'Task' if kind == 'task' else 'Capture'} not found", 404)
            current = dict(NEW[kind], id=kind, space=space, rev=0, deleted=False, conflicts=[],
                           created_at=op["at"], created_by=context.user, created_op=op["op_id"],
                           field_rev={}, field_at={}, field_src={})
        record, found = _merge(current, fields, op, device, kind)
        if found:
            return record, ("conflict", record, message)
        return record, ("merged" if message else "applied", record, message)

    return write(context.collection(COLLECTION[kind]), key, change)


def _delete(context, space, op, device, kind, key):
    if kind not in ("task", "inbox"):
        raise core.Bad("Only tasks and captures can be deleted")
    collection = context.collection(COLLECTION[kind])

    def change(current):
        if current is None or current["deleted"]:
            return None, ("applied", current, None)
        record = dict(current, rev=current["rev"] + 1, updated_at=op["at"])
        if any(_concurrent(current, name, op, device) for name in current["field_rev"]):
            record["conflicts"] = list(current.get("conflicts") or []) + [_conflict(op, "deleted", False, True, 0)]
            return record, ("conflict", record, "Kept, because it was changed somewhere else")
        record["deleted"] = True
        _set(record, "deleted", True, op, device)
        return record, ("applied", record, None)

    result = write(collection, key, change)
    if kind == "task" and result[1] is not None and result[1]["deleted"]:
        # Sub-tasks the deleting device did not know about stay, as tasks of their own.
        for child in list(collection.find({"space": space, "parent": op["id"], "deleted": False})):
            def detach(current):
                if current is None or current.get("parent") != op["id"]:
                    return None, None
                record = dict(current, rev=current["rev"] + 1)
                _set(record, "parent", None, op, device)
                return record, None
            write(collection, child["_id"], detach)
    return result


def _resolve(context, space, op, device, kind, key):
    """The user picks one side of a conflict."""
    fields = op.get("fields") or {}
    wanted, choice = fields.get("conflict"), fields.get("choice")
    if choice not in ("kept", "other"):
        raise core.Bad("choice must be kept or other")

    def change(current):
        conflict = next((row for row in (current or {}).get("conflicts") or [] if row["id"] == wanted), None)
        if conflict is None:
            return None, ("applied", current, None)
        record = dict(current, rev=current["rev"] + 1, updated_at=op["at"],
                      conflicts=[row for row in current["conflicts"] if row["id"] != wanted])
        if choice == "other":
            _set(record, conflict["field"], conflict["other"], op, device)
            if kind == "task" and conflict["field"] == "status":
                _status_times(record, op)
        return record, ("applied", record, None)

    return write(context.collection(COLLECTION[kind]), key, change)


def _report(context, op):
    """A crash or error from one of the user's devices."""
    fields = op.get("fields") if isinstance(op.get("fields"), dict) else {}
    errors = context.collection(core.ERRORS)

    def short(name, limit):
        value = fields.get(name)
        return value[:limit] if isinstance(value, str) else ""

    errors.update_one({"_id": f"{context.user}|{op['op_id']}"}, {"$setOnInsert": {
        "id": op["op_id"], "user": context.user, "at": op["at"], "received_at": core.stamp(context.now),
        "message": short("message", 1000) or "Unknown error", "where": short("where", 200),
        "stack": short("stack", 6000), "agent": short("agent", 300)}}, upsert=True)
    for old in list(errors.find({}, sort=[("received_at", -1)], skip=1000, limit=100)):
        errors.delete_one({"_id": old["_id"]})
    return "applied", None, None


ACTIONS = {"create": _create, "update": _update, "delete": _delete, "resolve": _resolve}


def apply(context, space, op, device):
    """Apply one operation. Returns {op_id, status, record, message}.

    status: applied; merged (applied with a note); conflict (both values kept for the user);
    rejected (not valid: the device keeps it for the user to fix); retry (send it again).
    """
    if not isinstance(op, dict):
        raise core.Bad("Each operation must be an object")
    op = dict(op)
    core.check_id(op.get("op_id"), "op_id")
    log = context.collection(core.OPS)
    log_key = f"{context.user}|{op['op_id']}"
    done = log.find_one({"_id": log_key})
    if done is not None:
        return {"op_id": op["op_id"], "status": done["status"], "message": done.get("message"), "duplicate": True}
    try:
        op["at"] = core.client_stamp(op.get("at"), context.now)
        if op.get("type") == "error":
            status, record, message = _report(context, op)
        else:
            kind, action = op.get("type"), op.get("action")
            if kind not in COLLECTION or action not in ACTIONS or (action == "create" and kind in ("schedule", "settings")):
                raise core.Bad("Unknown operation")
            if op.get("base_rev") is not None and type(op["base_rev"]) is not int:
                raise core.Bad("base_rev must be a number")
            if kind in ("schedule", "settings"):
                op["id"] = kind
            if kind == "settings":  # settings follow the person, not a shared space
                space = context.personal_space()["id"]
            key = key_of(context, space, kind, op.get("id"))
            status, record, message = ACTIONS[action](context, space, op, device, kind, key)
    except core.Bad as error:
        return {"op_id": op["op_id"], "status": "rejected", "message": error.message, "code": error.status}
    except core.Busy:
        return {"op_id": op["op_id"], "status": "retry", "message": "Busy, try again"}
    log.update_one({"_id": log_key}, {"$setOnInsert": {
        "id": op["op_id"], "space": space, "status": status, "message": message,
        "at": core.stamp(context.now)}}, upsert=True)
    return {"op_id": op["op_id"], "status": status, "message": message,
            "record": view(record) if record else None}


def change(context, space, kind, action, identifier=None, fields=None, base_rev=None):
    """The REST plugins' way in: same path, errors raised instead of returned."""
    result = apply(context, space, {"op_id": core.new_id(), "type": kind, "action": action, "id": identifier,
                                    "fields": fields, "base_rev": base_rev}, "api-" + context.user)
    if result["status"] == "rejected":
        raise core.Bad(result["message"], result["code"])
    if result["status"] == "retry":
        raise core.Busy()
    return result


# ---------------------------------------------------------------- reading

def settings_of(context):
    record = context.collection(core.SETTINGS).find_one({"_id": key_of(context, None, "settings", None)})
    return (dict({name: record.get(name, value) for name, value in DEFAULT_SETTINGS.items()}, rev=record["rev"])
            if record else dict(DEFAULT_SETTINGS, rev=0))


def conflicts_of(context, space):
    rows = []
    personal = context.personal_space()["id"]
    for kind, name in COLLECTION.items():
        owner = personal if kind == "settings" else space
        for record in context.collection(name).find({"space": owner, "conflicts.0": {"$exists": True}}):
            for conflict in record["conflicts"]:
                rows.append(dict(conflict, type=kind, record=record["id"],
                                 title=record.get("title") or record.get("text") or
                                 ("Daily schedule" if kind == "schedule" else "Settings")))
    return sorted(rows, key=lambda row: (row["at"], row["id"]))
