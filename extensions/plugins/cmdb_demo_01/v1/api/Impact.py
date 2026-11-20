"""What breaks if X goes down: downstream dependents via $graphLookup, with owners and redundancy.

GET /api/v1/cmdb_demo_01/Impact/?item=sw-core-01[,sw-core-02]
 -> {items, failed, affected, down, degraded, counts, owners, environments, prod_hit,
     severity, failover, covering, truncated, summary}

A what-if analysis: it does not change any status. Only depends links are
traversed; owns and redundant links never are, and cycles are safe.
"""

from extensions.plugins.cmdb_demo_01.api.v1 import _sim, _store
from system.interfaces.api_plugin_interface import ApiPluginInterface

MAX_ITEMS = 20


class Impact(ApiPluginInterface):
    DESCRIPTION = "Blast radius of CMDB demo items going down, with owner teams and redundancy"
    METHODS = ("GET",)

    def run(self, params=None, previous_result=None):
        params = params or {}
        return _store.handle(lambda: self._run(params))

    def _run(self, params):
        _store.require_method(params, "GET")
        _store.ensure_seeded(self)
        value = (params.get("args") or {}).get("item")
        if not value or not value.strip():
            raise _store.Failed("item is required, e.g. ?item=sw-core-01 or ?item=sw-core-01,sw-core-02")
        references = list(dict.fromkeys(part.strip() for part in value.split(",") if part.strip()))
        if len(references) > MAX_ITEMS:
            raise _store.Failed(f"At most {MAX_ITEMS} items per analysis")
        keys = [_store.find_item(self, reference)["key"] for reference in references]
        report, _ = _sim.impact(self, keys)
        return dict(report, items=keys), 200
