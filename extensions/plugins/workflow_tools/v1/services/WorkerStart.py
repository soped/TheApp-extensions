from collections.abc import Callable
from datetime import datetime, timezone

from system.interfaces.service_plugin_interface import ServicePluginInterface


class WorkerStart(ServicePluginInterface):
    """Trigger that always fires, emitting one item so the workflow's steps run.

    It opens no database connection, file, network or secret, so it is safe inside
    organization workflows. Config: `set` (object of static fields for the emitted item).
    The item also carries `triggered_at` (UTC ISO timestamp) unless `set` overrides it.
    """

    ORGANIZATION_SAFE = True
    WORKER_ROLES = ("trigger",)

    def run(self, params: dict | None = None, previous_result: list | None = None, return_callback: Callable | None = None):
        params = params or {}
        static = params.get("set")
        if static is not None and not isinstance(static, dict):
            raise ValueError("set must be an object")
        results = [{"triggered_at": datetime.now(timezone.utc).isoformat(), **(static or {})}]
        if return_callback:
            return_callback(results)
        return results
