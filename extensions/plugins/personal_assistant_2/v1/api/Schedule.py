"""The approximate day: wake, work start/end, bedtime, work days and fixed blocks.

GET   {schedule, saved, rev}
POST  {wake, work_start, work_end, bedtime, workdays, blocks, timezone, rev?}
"""

from system.interfaces.api_plugin_interface import ApiPluginInterface

from extensions.plugins.personal_assistant_2.api.v1 import _core as core
from extensions.plugins.personal_assistant_2.api.v1 import _store as store


class Schedule(ApiPluginInterface):
    DESCRIPTION = "The daily schedule the planner fills; sensible defaults until one is saved"

    @core.guarded
    def run(self, context):
        space = context.space()
        if context.method != "GET":
            value = {name: item for name, item in context.body.items() if name not in ("space", "rev")}
            store.change(context, space, "schedule", "update", None, {"value": value}, context.body.get("rev"))
        record = context.collection(core.SCHEDULES).find_one({"_id": f"{space}|schedule|schedule"})
        schedule, saved = core.load_schedule(context.db, space)
        return {"schedule": schedule, "saved": saved, "rev": record["rev"] if record else 0}, 200
