"""Shared request handling, validation and space access for the Personal Assistant 2 API."""

import functools
import hashlib
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# The assistant_ prefix keeps these in the family that platform CRUD guards cover where deployed.
SPACES = "assistant_pa2_spaces"
TASKS = "assistant_pa2_tasks"
INBOX = "assistant_pa2_inbox"
SCHEDULES = "assistant_pa2_schedules"
SETTINGS = "assistant_pa2_settings"
PLANS = "assistant_pa2_plans"
OPS = "assistant_pa2_ops"
ERRORS = "assistant_pa2_errors"
BACKUPS = "assistant_pa2_backups"
BACKUP_PARTS = "assistant_pa2_backup_parts"

ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
TIME = re.compile(r"([01]\d|2[0-3]):([0-5]\d)")
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


class Bad(Exception):
    """A request the caller can correct."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


class Busy(Exception):
    """The record kept changing; the caller should retry the same request."""


def utcnow():
    """The only clock. Tests replace it with a fixed one."""
    return datetime.now(timezone.utc)


def stamp(moment):
    """One fixed-width UTC format, so stored times compare correctly as text."""
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def parse_stamp(value, label="time"):
    if not isinstance(value, str):
        raise Bad(f"{label} must be an ISO time")
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise Bad(f"{label} must be an ISO time") from None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    try:
        return moment.astimezone(timezone.utc)
    except OverflowError:
        raise Bad(f"{label} is out of range") from None


def client_stamp(value, now):
    """A device's time, never later than the server's: a fast clock must not win every conflict."""
    if value is None:
        return stamp(now)
    return stamp(min(parse_stamp(value, "at"), now))


def new_id():
    return uuid.uuid4().hex


def check_id(value, label="id"):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise Bad(f"{label} is invalid")
    return value


def parse_day(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise Bad("date must be YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise Bad("date must be YYYY-MM-DD") from None


def minutes(value, label="time"):
    if not isinstance(value, str) or not TIME.fullmatch(value):
        raise Bad(f"{label} must be HH:MM")
    return int(value[:2]) * 60 + int(value[3:])


def hhmm(value):
    return f"{value // 60 % 24:02d}:{value % 60:02d}"


def zone(name):
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, TypeError, OSError):
        return timezone.utc


class Context:
    """The verified user, their organization's database and this request."""

    def __init__(self, params, request=None):
        request = request or {}
        identity = params.get("identity") or {}
        self.user = str(identity.get("user_id") or "")
        self.organization = str(identity.get("organization_id") or "")
        if not self.user or not self.organization:
            raise Bad("A signed-in member is required", 403)
        self.admin = (identity.get("properties") or {}).get("user_type") == "admin"
        self.db = (params.get("drivers") or {}).get("mongodb")
        if self.db is None:
            raise Bad("The database is unavailable", 503)
        self.method = request.get("method") or "GET"
        body = request.get("json")
        self.body = body if isinstance(body, dict) else {}
        self.args = request.get("args") or {}
        self.now = utcnow()

    def collection(self, name):
        return self.db.get_collection(name)

    def arg(self, name):
        return self.body[name] if name in self.body else self.args.get(name)

    # --- spaces: the only way to reach a space is through these two ---

    def personal_space(self):
        digest = hashlib.sha256(f"{self.organization}:{self.user}".encode()).hexdigest()[:24]
        identifier = "p" + digest
        spaces = self.collection(SPACES)
        space = spaces.find_one({"_id": identifier})
        if space is None:
            spaces.update_one({"_id": identifier}, {"$setOnInsert": {
                "id": identifier, "name": "Personal", "personal": True, "owner": self.user,
                "members": [self.user], "created_at": stamp(self.now)}}, upsert=True)
            space = spaces.find_one({"_id": identifier})
        return space

    def space(self):
        """The requested space if the user belongs to it, else their personal space."""
        wanted = self.arg("space")
        if wanted in (None, ""):
            return self.personal_space()["id"]
        check_id(wanted, "space")
        found = self.collection(SPACES).find_one({"_id": wanted, "members": self.user})
        if found is None:
            raise Bad("Space not found", 404)
        return found["id"]

    def spaces(self):
        self.personal_space()
        rows = [row for row in self.collection(SPACES).find({"members": self.user})]
        return sorted(rows, key=lambda row: (not row.get("personal"), row["name"].lower(), row["id"]))


def space_view(space, user):
    return {"id": space["id"], "name": space["name"], "personal": bool(space.get("personal")),
            "owner": space["owner"] == user, "members": list(space["members"])}


def guarded(run):
    """Turn Bad/Busy into JSON errors; anything else is a real fault and stays visible."""

    @functools.wraps(run)
    def wrapper(self, params=None):
        try:
            return run(self, Context(self.params, params))
        except Bad as error:
            return {"error": error.message}, error.status
        except Busy:
            return {"error": "The record changed at the same moment; try again"}, 409

    return wrapper


# ---------------------------------------------------------------- daily schedule

DEFAULT_SCHEDULE = {
    "wake": "07:00", "work_start": "09:00", "work_end": "17:00", "bedtime": "23:00",
    "workdays": ["mon", "tue", "wed", "thu", "fri"], "blocks": [], "timezone": None,
}


def after(value, start):
    """Minutes on the day's own line: a time before wake-up belongs to after midnight."""
    return value + 1440 if value < start else value


def clean_schedule(data):
    """Validate a complete schedule and return it normalised."""
    if not isinstance(data, dict):
        raise Bad("A schedule is required")
    unknown = set(data) - set(DEFAULT_SCHEDULE)
    if unknown:
        raise Bad("Unknown schedule fields: " + ", ".join(sorted(unknown)))
    wake = minutes(data.get("wake"), "Wake time")
    start = minutes(data.get("work_start"), "Work start")
    end = minutes(data.get("work_end"), "Work end")
    bed = after(minutes(data.get("bedtime"), "Bedtime"), wake)
    if not wake <= start < end <= bed:
        raise Bad("Times must run in this order: wake, work start, work end, bedtime")
    days = data.get("workdays")
    if not isinstance(days, list) or any(day not in DAYS for day in days) or len(set(days)) != len(days):
        raise Bad("Work days must be a list of: " + ", ".join(DAYS))
    blocks = data.get("blocks", [])
    if not isinstance(blocks, list) or len(blocks) > 20:
        raise Bad("There can be at most 20 fixed blocks")
    spans = []
    for block in blocks:
        if not isinstance(block, dict):
            raise Bad("Each fixed block needs a name, start and end")
        name = block.get("name")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
            raise Bad("Each fixed block needs a name of at most 80 characters")
        first = after(minutes(block.get("start"), "Block start"), wake)
        last = after(minutes(block.get("end"), "Block end"), wake)
        if not first < last <= bed:
            raise Bad(f"Fixed block {name.strip()} must start before it ends, between wake and bedtime")
        spans.append((first, last, name.strip()))
    spans.sort()
    if any(one[1] > two[0] for one, two in zip(spans, spans[1:])):
        raise Bad("Fixed blocks must not overlap")
    timezone_name = data.get("timezone")
    if timezone_name is not None and (not isinstance(timezone_name, str) or len(timezone_name) > 64):
        raise Bad("Time zone is invalid")
    return {"wake": hhmm(wake), "work_start": hhmm(start), "work_end": hhmm(end), "bedtime": hhmm(bed),
            "workdays": sorted(days, key=DAYS.index),
            "blocks": [{"name": name, "start": hhmm(a), "end": hhmm(b)} for a, b, name in spans],
            "timezone": timezone_name}


def load_schedule(db, space):
    """(schedule, saved): the saved schedule, or the defaults."""
    record = db.get_collection(SCHEDULES).find_one({"_id": f"{space}|schedule|schedule"})
    if not record or not record.get("value"):
        return dict(DEFAULT_SCHEDULE, blocks=[]), False
    return clean_schedule(record["value"]), True


def local_day(now, schedule, requested_zone=None):
    """(date, minute) of the user's own day. Before wake-up it is still yesterday's evening if
    the bedtime is after midnight and has not passed yet."""
    here = now.astimezone(zone(schedule.get("timezone") or requested_zone or "UTC"))
    minute = here.hour * 60 + here.minute
    wake = minutes(schedule["wake"])
    bed = after(minutes(schedule["bedtime"]), wake)
    if minute < wake and minute + 1440 < bed:
        return here.date() - timedelta(days=1), minute + 1440
    return here.date(), minute
