"""The inbox: one-line captures, sorted later.

GET   {inbox} (?status=inbox|sorted, default inbox; ?space=)
POST  {text, source: text|voice, captured_at?}   capture
      {id, text?, status?}                       edit or mark sorted
      {id, action: delete}                       delete
"""

from system.interfaces.api_plugin_interface import ApiPluginInterface

from extensions.plugins.personal_assistant_2.api.v1 import _core as core
from extensions.plugins.personal_assistant_2.api.v1 import _store as store


class Inbox(ApiPluginInterface):
    DESCRIPTION = "Quick captures by text or voice, kept in the inbox until sorted"

    @core.guarded
    def run(self, context):
        space = context.space()
        identifier = context.arg("id")
        if context.method == "GET":
            status = context.arg("status") or "inbox"
            if status not in ("inbox", "sorted"):
                raise core.Bad("status must be inbox or sorted")
            rows = context.collection(core.INBOX).find({"space": space, "deleted": False, "status": status})
            rows = sorted(rows, key=lambda row: (row["captured_at"], row["id"]), reverse=True)
            return {"inbox": [store.view(row) for row in rows]}, 200
        fields = {name: value for name, value in context.body.items() if name not in ("id", "space", "action", "rev")}
        action = context.body.get("action")
        if not identifier:
            if action:
                raise core.Bad("id is required")
            result = store.change(context, space, "inbox", "create", core.new_id(), fields)
            return {"capture": result["record"]}, 201
        if action == "delete":
            if store.change(context, space, "inbox", "delete", identifier)["record"] is None:
                raise core.Bad("Capture not found", 404)
            return {"deleted": identifier}, 200
        if action is not None:
            raise core.Bad("action must be delete")
        result = store.change(context, space, "inbox", "update", identifier, fields, context.body.get("rev"))
        return {"capture": result["record"]}, 200
