"""The signed-in user's display settings.

GET   {settings}
POST  {colour_mode, energy, motion} (any of them)
"""

from system.interfaces.api_plugin_interface import ApiPluginInterface

from extensions.plugins.personal_assistant_2.api.v1 import _core as core
from extensions.plugins.personal_assistant_2.api.v1 import _store as store


class Settings(ApiPluginInterface):
    DESCRIPTION = "Colour-blind mode, energy and motion settings of the signed-in user"

    @core.guarded
    def run(self, context):
        if context.method != "GET":
            fields = {name: value for name, value in context.body.items() if name != "rev"}
            store.change(context, None, "settings", "update", None, fields, context.body.get("rev"))
        return {"settings": store.settings_of(context)}, 200
