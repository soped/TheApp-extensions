"""Tasks and sub-tasks in one space.

GET   {tasks} (?id= for {task}, ?status=, ?space=)
POST  {title, context, duration, deadline, must_do, status, parent}            create
      {id, ...changed fields, rev?}                                            edit
      {id, action: start | finish | reopen | delete}                           change state
"""

from system.interfaces.api_plugin_interface import ApiPluginInterface

from extensions.plugins.personal_assistant_2.api.v1 import _core as core
from extensions.plugins.personal_assistant_2.api.v1 import _store as store

STATUS = {"start": "started", "finish": "done", "reopen": "open"}


class Tasks(ApiPluginInterface):
    DESCRIPTION = "Create, edit, start, finish and delete tasks and sub-tasks in a space"

    @core.guarded
    def run(self, context):
        space = context.space()
        tasks = context.collection(core.TASKS)
        identifier = context.arg("id")
        if context.method == "GET":
            return self._read(context, space, tasks, identifier)
        fields = {name: value for name, value in context.body.items() if name not in ("id", "space", "action", "rev")}
        action = context.body.get("action")
        if not identifier:
            if action:
                raise core.Bad("id is required")
            result = store.change(context, space, "task", "create", core.new_id(), fields)
            return {"task": result["record"], "message": result["message"]}, 201
        if action is None:
            result = store.change(context, space, "task", "update", identifier, fields, context.body.get("rev"))
            return {"task": result["record"], "message": result["message"]}, 200
        if action not in (*STATUS, "delete"):
            raise core.Bad("action must be start, finish, reopen or delete")
        if fields:
            raise core.Bad("An action takes no other fields")
        self._find(space, tasks, identifier)
        children = [child["id"] for child in tasks.find({"space": space, "parent": identifier, "deleted": False})
                    if action == "delete" or child["status"] != "done"]
        if action == "delete":
            for child in children:
                store.change(context, space, "task", "delete", child)
            store.change(context, space, "task", "delete", identifier)
            return {"deleted": [*children, identifier]}, 200
        if action == "finish":
            for child in children:
                store.change(context, space, "task", "update", child, {"status": "done"})
        result = store.change(context, space, "task", "update", identifier, {"status": STATUS[action]})
        return {"task": result["record"], "message": result["message"]}, 200

    def _find(self, space, tasks, identifier):
        found = tasks.find_one({"_id": f"{space}|task|{core.check_id(identifier)}", "deleted": False})
        if found is None:
            raise core.Bad("Task not found", 404)
        return found

    def _read(self, context, space, tasks, identifier):
        if identifier:
            return {"task": store.view(self._find(space, tasks, identifier))}, 200
        query = {"space": space, "deleted": False}
        status = context.arg("status")
        if status:
            if status not in store.STATUS:
                raise core.Bad("status must be one of: " + ", ".join(store.STATUS))
            query["status"] = status
        rows = sorted(tasks.find(query), key=lambda task: (task["created_at"], task["id"]))
        return {"tasks": [store.view(task) for task in rows]}, 200
