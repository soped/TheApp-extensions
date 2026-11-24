"""Backups of a space: made daily on its own, downloadable, and restorable.

GET   {backups}; ?id= downloads one as {backup}
POST  {action: create} | {action: restore, id} | {action: restore, backup: <downloaded file>}
"""

from system.interfaces.api_plugin_interface import ApiPluginInterface

from extensions.plugins.personal_assistant_2.api.v1 import _backup as backup
from extensions.plugins.personal_assistant_2.api.v1 import _core as core


class Backup(ApiPluginInterface):
    DESCRIPTION = "Daily backups of a space's tasks, inbox, schedule and plans, with restore"

    @core.guarded
    def run(self, context):
        space = context.space()
        identifier = context.arg("id")
        if context.method == "GET":
            if identifier:
                return {"backup": backup.read(context, space, identifier)}, 200
            return {"backups": backup.listing(context, space)}, 200
        action = context.body.get("action")
        if action == "create":
            return {"created": backup.create(context, space, "manual")}, 201
        if action != "restore":
            raise core.Bad("action must be create or restore")
        content = context.body["backup"] if "backup" in context.body else backup.read(context, space, identifier)
        return backup.restore(context, space, content), 200
