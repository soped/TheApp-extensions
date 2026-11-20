"""CMDB demo items: GET list/filter or one item; POST create, update (manual edits) or delete.

GET  /api/v1/cmdb_demo_01/Items/[?type=&owner=&status=&environment=&q=]
     -> {items, teams, filters, total}
GET  /api/v1/cmdb_demo_01/Items/?item=<key>  -> {item}
POST {action: "create", key, name?, type, owner, environment, status?, notes?, ip?, subtype?}
POST {action: "update", item, status?, notes?, name?, owner?, environment?}  (status change writes an event)
POST {action: "delete", item}  (also deletes the item's relations)
"""

import re

from extensions.plugins.cmdb_demo_01.api.v1 import _sim, _store
from system.interfaces.api_plugin_interface import ApiPluginInterface

FILTERS = ("type", "owner", "status", "environment")
KEY = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")


class Items(ApiPluginInterface):
    DESCRIPTION = "CMDB demo items with filters by type, owner, status and environment"

    def run(self, params=None, previous_result=None):
        params = params or {}
        return _store.handle(lambda: self._run(params))

    def _run(self, params):
        _store.require_method(params, "GET", "POST")
        _store.ensure_seeded(self)
        if params["method"] == "GET":
            return self._read(params.get("args") or {})
        body = params.get("json") or {}
        action = body.get("action")
        if action == "create":
            return self._create(body)
        if action == "update":
            return self._update(body)
        if action == "delete":
            return self._delete(body)
        raise _store.Failed("action must be create, update or delete")

    def _read(self, args):
        team_map = _store.teams(self)
        if args.get("item"):
            return {"item": _store.public_item(_store.find_item(self, args["item"]), team_map)}, 200
        documents = _store.items(self)
        every = [_store.public_item(doc, team_map) for doc in documents]
        filters = {
            "types": sorted({item["type"] for item in every if item["type"]}),
            "owners": [{"key": key, "name": team["name"]} for key, team in team_map.items()],
            "statuses": sorted({item["status"] for item in every if item["status"]}),
            "environments": sorted({item["environment"] for item in every if item["environment"]}),
        }
        selected = every
        for name in FILTERS:
            value = args.get(name)
            if value:
                selected = [item for item in selected if item[name] == value]
        query = (args.get("q") or "").strip().lower()
        if query:
            selected = [item for item in selected
                        if query in " ".join((item["key"], item["name"], item["notes"], item["ip"])).lower()]
        return {"items": selected, "teams": [_store.public_team(team) for team in team_map.values()],
                "filters": filters, "total": len(every)}, 200

    def _fields(self, body, team_map):
        fields = {}
        if "name" in body:
            fields["name"] = _store.text(body["name"], "name", 120, required=True)
        if "notes" in body:
            fields["notes"] = _store.text(body["notes"], "notes", 1000)
        if "ip" in body:
            fields["ip"] = _store.text(body["ip"], "ip", 64)
        if "subtype" in body:
            fields["subtype"] = _store.text(body["subtype"], "subtype", 64)
        if "type" in body:
            if body["type"] not in _store.TYPES:
                raise _store.Failed("type must be one of " + ", ".join(_store.TYPES))
            fields["type"] = body["type"]
        if "owner" in body:
            if body["owner"] not in team_map:
                raise _store.Failed(f"Unknown owner team: {body['owner']}", 404)
            fields["owner"] = body["owner"]
        if "environment" in body:
            fields["environment"] = _store.text(body["environment"], "environment", 32, required=True)
        if "status" in body:
            if body["status"] not in _store.STATUSES:
                raise _store.Failed("status must be one of " + ", ".join(_store.STATUSES))
            fields["base_status"] = body["status"]
        return fields

    def _create(self, body):
        team_map = _store.teams(self)
        key = _store.text(body.get("key"), "key", 64, required=True)
        if not KEY.fullmatch(key):
            raise _store.Failed("key must use lowercase letters, numbers and hyphens")
        if _store.collection(self, _store.ITEMS).find_one({"key": key}) or key in team_map:
            raise _store.Failed(f"{key} already exists", 409)
        for required in ("type", "owner", "environment"):
            if required not in body:
                raise _store.Failed(f"{required} is required")
        fields = self._fields(dict({"name": key, "status": "operational"}, **body), team_map)
        moment = _store.now()
        document = dict(fields, key=key, status=fields["base_status"], impact=None, impacted_by=[],
                        demo=False, updated_at=moment)
        document.setdefault("notes", "")
        document["_id"] = _store.collection(self, _store.ITEMS).insert_one(document).inserted_id
        return {"item": _store.public_item(document, team_map)}, 201

    def _update(self, body):
        team_map = _store.teams(self)
        item = _store.find_item(self, body.get("item"))
        fields = self._fields({key: value for key, value in body.items() if key not in ("action", "item", "key")},
                              team_map)
        if not fields:
            raise _store.Failed("Nothing to update")

        def change(state, moment, changes):
            items = _store.collection(self, _store.ITEMS)
            items.update_one({"_id": item["_id"]}, {"$set": dict(fields, updated_at=moment)})
            event = None
            if "base_status" in fields and fields["base_status"] != item.get("base_status"):
                affected, report = _sim.recompute(self, _sim.failures(state), moment)
                current = items.find_one({"_id": item["_id"]})
                event = _sim.write_event(self, moment, kind="manual", source="manual", item=current,
                                         old_status=item.get("status"), new_status=current.get("status"),
                                         affected=affected, report=report)
            return {"item": _store.public_item(items.find_one({"_id": item["_id"]}), team_map), "event": event}, 200

        return _sim.locked(self, change)

    def _delete(self, body):
        item = _store.find_item(self, body.get("item"))

        def remove(state, moment, changes):
            relations = _store.collection(self, _store.RELATIONS)
            removed = (relations.delete_many({"source_id": item["_id"]}).deleted_count
                       + relations.delete_many({"target_id": item["_id"]}).deleted_count)
            _store.collection(self, _store.ITEMS).delete_one({"_id": item["_id"]})
            active = [failure for failure in _sim.failures(state) if failure["key"] != item["key"]]
            changes["failures"] = active
            _sim.recompute(self, active, moment)
            return {"deleted": item["key"], "relations_deleted": removed}, 200

        return _sim.locked(self, remove)
