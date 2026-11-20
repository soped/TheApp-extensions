from collections.abc import Callable

from system.interfaces.service_plugin_interface import ServicePluginInterface

MAX_LIMIT = 10000


class WorkerTransform(ServicePluginInterface):
    """Reshapes the previous step's results in memory.

    It opens no database connection, file, network or secret and never reads data other
    than its input, so it is safe inside organization workflows.
    Config: `pick` (list of top-level fields to keep), `set` (object of static fields to add,
    overriding), `limit` (maximum number of items, 0 = all).
    """

    ORGANIZATION_SAFE = True

    def run(self, params: dict | None = None, previous_result: list | None = None, return_callback: Callable | None = None):
        params = params or {}
        pick = params.get("pick")
        static = params.get("set")
        limit = params.get("limit", 0)

        if pick is not None and (not isinstance(pick, list) or not all(isinstance(f, str) for f in pick)):
            raise ValueError("pick must be a list of field names")
        if static is not None and not isinstance(static, dict):
            raise ValueError("set must be an object")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 0 <= limit <= MAX_LIMIT:
            raise ValueError(f"limit must be an integer between 0 and {MAX_LIMIT}")

        results = []
        for item in previous_result or []:
            if isinstance(item, dict):
                item = {k: v for k, v in item.items() if k in pick} if pick is not None else dict(item)
                item.update(static or {})
            results.append(item)
        if limit:
            results = results[:limit]

        if return_callback:
            return_callback(results)
        return results
