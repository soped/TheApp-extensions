"""Crash and error reports from the web app.

GET   {reports} newest first: your own; administrators see the whole organization (?all=1)
POST  {message, where, stack, agent}
"""

from system.interfaces.api_plugin_interface import ApiPluginInterface

from extensions.plugins.personal_assistant_2.api.v1 import _core as core
from extensions.plugins.personal_assistant_2.api.v1 import _store as store

FIELDS = ("id", "user", "at", "received_at", "message", "where", "stack", "agent")


class ErrorReports(ApiPluginInterface):
    DESCRIPTION = "Crash and error reports; administrators see the organization's"

    @core.guarded
    def run(self, context):
        if context.method != "GET":
            store.apply(context, None, {"op_id": core.new_id(), "type": "error", "fields": context.body}, "api")
            return {"reported": True}, 201
        query = {} if context.admin and context.arg("all") else {"user": context.user}
        rows = context.collection(core.ERRORS).find(query, sort=[("received_at", -1)], limit=100)
        return {"reports": [{name: row[name] for name in FIELDS} for row in rows]}, 200
