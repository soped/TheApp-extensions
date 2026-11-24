"""Offline sync for the web app, and later the phone and desktop apps.

GET   {results: [], state} (?space=, ?tz=)
POST  {device, ops: [{op_id, type, action, id, fields, base_rev, at}], space?, tz?}
      -> {results: [{op_id, status, message}], state}

Operations are applied in order. Each one answers for itself, so one bad operation never
blocks or loses the others, and resending a batch is safe.
"""

from datetime import timedelta

from system.interfaces.api_plugin_interface import ApiPluginInterface

from extensions.plugins.personal_assistant_2.api.v1 import _backup as backup
from extensions.plugins.personal_assistant_2.api.v1 import _core as core
from extensions.plugins.personal_assistant_2.api.v1 import _planner as planner
from extensions.plugins.personal_assistant_2.api.v1 import _store as store

LIMIT = 100


def state(context, space):
    """Everything a device needs to keep working offline."""
    schedule, saved = core.load_schedule(context.db, space)
    record = context.collection(core.SCHEDULES).find_one({"_id": f"{space}|schedule|schedule"})
    zone = context.arg("tz")
    today, _ = core.local_day(context.now, schedule, zone)
    tomorrow = today + timedelta(days=1)
    since = core.stamp(context.now - timedelta(days=3))
    tasks = [task for task in context.collection(core.TASKS).find({"space": space, "deleted": False})
             if task["status"] != "done" or (task.get("finished_at") or "") >= since]
    inbox = context.collection(core.INBOX).find({"space": space, "deleted": False, "status": "inbox"})
    return {
        "space": space, "spaces": [core.space_view(row, context.user) for row in context.spaces()],
        "server_time": core.stamp(context.now), "today": today.isoformat(),
        "tasks": [store.view(task) for task in sorted(tasks, key=lambda row: (row["created_at"], row["id"]))],
        "inbox": [store.view(row) for row in
                  sorted(inbox, key=lambda row: (row["captured_at"], row["id"]), reverse=True)],
        "schedule": {"value": schedule, "saved": saved, "rev": record["rev"] if record else 0},
        "settings": store.settings_of(context),
        "conflicts": store.conflicts_of(context, space),
        # Tomorrow's is a preview, so the app still has a plan if the night is spent offline.
        "plans": {day.isoformat(): planner.plan_for_date(
            context.db, space, day, context.now, store=day == today, requested_zone=zone)
            for day in (today, tomorrow)},
    }


class Sync(ApiPluginInterface):
    DESCRIPTION = "Applies a device's queued offline changes and returns the state to cache"

    @core.guarded
    def run(self, context):
        space = context.space()
        results = []
        if context.method != "GET":
            device = core.check_id(context.body.get("device"), "device")
            ops = context.body.get("ops", [])
            if not isinstance(ops, list) or len(ops) > LIMIT:
                raise core.Bad(f"ops must be a list of at most {LIMIT} operations")
            # The device name is tied to the user: nobody can pose as another member's device.
            results = [store.apply(context, space, op, f"{context.user}:{device}") for op in ops]
            if ops:
                backup.daily(context, space)
        return {"results": results, "state": state(context, space)}, 200
