"""Relations between CMDB demo items: depends, owns and redundant links with a type and label.

GET  /api/v1/cmdb_demo_01/Relations/?item=<key>  -> {item, outgoing, incoming}
GET  /api/v1/cmdb_demo_01/Relations/[?type=]     -> {relations}
POST {action: "create", source, target, type, label?, group?}  -> 201 {relation}
     Both ends must exist (items, or a team as the source of an owns link).
POST {action: "update", id, label?, group?}  -> {relation}
POST {action: "delete", id}  -> {deleted}
"""

from bson import ObjectId
from bson.errors import InvalidId

from extensions.plugins.cmdb_demo_01.api.v1 import _sim, _store
from system.interfaces.api_plugin_interface import ApiPluginInterface


def public(relation, names):
    return {
        "id": str(relation["_id"]), "source": relation["source"], "target": relation["target"],
        "source_name": names.get(relation["source_id"], relation["source"]),
        "target_name": names.get(relation["target_id"], relation["target"]),
        "source_kind": relation.get("source_kind") or ("team" if relation["type"] == "owns" else "item"),
        "target_kind": relation.get("target_kind") or "item",
        "type": relation["type"], "label": relation.get("label") or "", "group": relation.get("group") or None,
    }


class Relations(ApiPluginInterface):
    DESCRIPTION = "Create, list and delete depends/owns/redundant links between CMDB demo items"

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

    def _names(self):
        names = {doc["_id"]: doc.get("name") or doc["key"] for doc in _store.items(self)}
        names.update({doc["_id"]: doc["name"] for doc in _store.teams(self).values()})
        return names

    def _read(self, args):
        relations = _store.collection(self, _store.RELATIONS)
        names = self._names()
        if args.get("item"):
            item = _store.find_item(self, args["item"])
            outgoing = [public(rel, names) for rel in relations.find({"source_id": item["_id"]}, sort=[("target", 1)])]
            incoming = [public(rel, names) for rel in relations.find({"target_id": item["_id"]}, sort=[("source", 1)])]
            return {"item": item["key"], "outgoing": outgoing, "incoming": incoming}, 200
        query = {}
        if args.get("type"):
            if args["type"] not in _store.RELATION_TYPES:
                raise _store.Failed("type must be one of " + ", ".join(_store.RELATION_TYPES))
            query["type"] = args["type"]
        found = relations.find(query, sort=[("type", 1), ("source", 1), ("target", 1)])
        return {"relations": [public(rel, names) for rel in found]}, 200

    def _relation(self, value):
        try:
            relation_id = ObjectId(value) if isinstance(value, str) else None
        except InvalidId:
            relation_id = None
        if relation_id is None:
            raise _store.Failed("id must be a relation id")
        relation = _store.collection(self, _store.RELATIONS).find_one({"_id": relation_id})
        if relation is None:
            raise _store.Failed("Unknown relation", 404)
        return relation

    def _group(self, body, kind):
        group = _store.text(body.get("group"), "group", 40) or None
        if group and kind != "depends":
            raise _store.Failed("Only depends links can have a redundant group")
        return group

    def _create(self, body):
        kind = body.get("type")
        if kind not in _store.RELATION_TYPES:
            raise _store.Failed("type must be one of " + ", ".join(_store.RELATION_TYPES))
        source, source_kind = _store.find_end(self, body.get("source"), "source")
        target, target_kind = _store.find_end(self, body.get("target"), "target")
        if source["_id"] == target["_id"]:
            raise _store.Failed("An item cannot be linked to itself")
        if kind == "owns" and (source_kind, target_kind) != ("team", "item"):
            raise _store.Failed("owns links go from a team to an item it owns")
        if kind != "owns" and (source_kind, target_kind) != ("item", "item"):
            raise _store.Failed(f"{kind} links connect two items")
        label = _store.text(body.get("label"), "label", 120) or ("owns" if kind == "owns" else kind)
        group = self._group(body, kind)
        relations = _store.collection(self, _store.RELATIONS)
        duplicate = relations.find_one({"source_id": source["_id"], "target_id": target["_id"], "type": kind})
        if duplicate is not None:
            raise _store.Failed("This relation already exists", 409)

        def create(state, moment, changes):
            document = {"source": source["key"], "target": target["key"], "source_id": source["_id"],
                        "target_id": target["_id"], "source_kind": source_kind, "target_kind": target_kind,
                        "type": kind, "label": label, "group": group, "demo": False, "created_at": moment}
            document["_id"] = relations.insert_one(document).inserted_id
            if kind == "depends":
                _sim.recompute(self, _sim.failures(state), moment)
            return {"relation": public(document, self._names())}, 201

        return _sim.locked(self, create)

    def _update(self, body):
        relation = self._relation(body.get("id"))
        fields = {}
        if "label" in body:
            fields["label"] = _store.text(body["label"], "label", 120, required=True)
        if "group" in body:
            fields["group"] = self._group(body, relation["type"])
        if not fields:
            raise _store.Failed("Nothing to update")

        def update(state, moment, changes):
            relations = _store.collection(self, _store.RELATIONS)
            relations.update_one({"_id": relation["_id"]}, {"$set": fields})
            if relation["type"] == "depends":
                _sim.recompute(self, _sim.failures(state), moment)
            return {"relation": public(relations.find_one({"_id": relation["_id"]}), self._names())}, 200

        return _sim.locked(self, update)

    def _delete(self, body):
        relation = self._relation(body.get("id"))

        def delete(state, moment, changes):
            _store.collection(self, _store.RELATIONS).delete_one({"_id": relation["_id"]})
            if relation["type"] == "depends":
                _sim.recompute(self, _sim.failures(state), moment)
            return {"deleted": str(relation["_id"])}, 200

        return _sim.locked(self, delete)
