"""The day plan of one space.

GET   {plan} (?date=YYYY-MM-DD, default today; ?tz=, ?space=)
POST  {date?, tz?, space?}  replan: move what was not started to the time that is left
"""

from system.interfaces.api_plugin_interface import ApiPluginInterface

from extensions.plugins.personal_assistant_2.api.v1 import _core as core
from extensions.plugins.personal_assistant_2.api.v1 import _planner as planner


class Plan(ApiPluginInterface):
    DESCRIPTION = "The plan for a date, made by the rule-based planner; POST replans"

    @core.guarded
    def run(self, context):
        space = context.space()
        day = context.arg("date")
        plan = planner.plan_for_date(
            context.db, space, core.parse_day(day) if day else None, context.now,
            replan=context.method != "GET", requested_zone=context.arg("tz"))
        return {"plan": plan}, 200
