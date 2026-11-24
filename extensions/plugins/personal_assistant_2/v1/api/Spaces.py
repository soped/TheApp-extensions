"""The spaces the signed-in user belongs to.

GET   {spaces}
POST  {action: create, name} | {action: add_member | remove_member, space, user_id} (owner only)
"""

from system.interfaces.api_plugin_interface import ApiPluginInterface

from extensions.plugins.personal_assistant_2.api.v1 import _core as core


class Spaces(ApiPluginInterface):
    DESCRIPTION = "Spaces the user belongs to; owners create spaces and choose members"

    @core.guarded
    def run(self, context):
        if context.method == "GET":
            return {"spaces": [core.space_view(space, context.user) for space in context.spaces()]}, 200
        spaces = context.collection(core.SPACES)
        action = context.body.get("action")
        if action == "create":
            name = context.body.get("name")
            if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
                raise core.Bad("name must be 1 to 80 characters")
            space = {"id": core.new_id(), "name": name.strip(), "personal": False, "owner": context.user,
                     "members": [context.user], "created_at": core.stamp(context.now)}
            spaces.update_one({"_id": space["id"]}, {"$setOnInsert": space}, upsert=True)
            return {"space": core.space_view(space, context.user)}, 201
        if action not in ("add_member", "remove_member"):
            raise core.Bad("action must be create, add_member or remove_member")
        space = spaces.find_one({"_id": context.space()})
        if space.get("personal"):
            raise core.Bad("A personal space has one member")
        if space["owner"] != context.user:
            raise core.Bad("Only the owner can change members", 403)
        member = core.check_id(context.body.get("user_id"), "user_id")
        if action == "remove_member" and member == space["owner"]:
            raise core.Bad("The owner cannot leave the space")
        change = {"$addToSet" if action == "add_member" else "$pull": {"members": member}}
        spaces.update_one({"_id": space["id"]}, change)
        return {"space": core.space_view(spaces.find_one({"_id": space["id"]}), context.user)}, 200
