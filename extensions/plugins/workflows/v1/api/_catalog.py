"""Workflow document fields and step flags.

The trigger and step plugins themselves are discovered by the platform: every installed
`package.Worker<Name>` service plugin that declares `ORGANIZATION_SAFE = True` and ships its
settings editor widget `worker_<name>` (see system/modules/worker_catalog.py).
"""

WORKFLOW_FIELDS = [
    {"name": "name", "type": "string", "required": True, "description": "Unique per organization, max 100 characters"},
    {"name": "group", "type": "string", "required": False, "default": "", "description": "Optional label for grouping workflows"},
    {"name": "active", "type": "boolean", "required": False, "default": False},
    {"name": "interval_seconds", "type": "integer", "required": True, "min": 0, "max": 86400,
     "description": "0 = manual (run now only), otherwise 10 to 86400 seconds; must be 0 when cron is set"},
    {"name": "cron", "type": "string", "required": False, "default": "",
     "description": "Optional 5-field cron expression (minute hour day-of-month month day-of-week), e.g. '0 8 * * 1-5'; requires interval_seconds 0"},
    {"name": "timezone", "type": "string", "required": False, "default": "UTC",
     "description": "IANA timezone for cron (DST-aware), e.g. Europe/Copenhagen; only valid together with cron"},
    {"name": "worker_node", "type": "string", "required": True, "description": "Name of an existing service node"},
    {"name": "trigger", "type": "object", "required": True, "description": "{plugin, params}; its result feeds the first step"},
    {"name": "workflow", "type": "array", "required": True,
     "description": "Ordered [{plugin, params, always_run?, require_last_result?}], 1 to 20 steps"},
]

STEP_FLAGS = [
    {"name": "require_last_result", "type": "boolean", "default": True,
     "description": "Skip this and later steps when the previous result is empty"},
    {"name": "always_run", "type": "boolean", "default": False,
     "description": "Run even after an earlier step failed or stopped the workflow"},
]
