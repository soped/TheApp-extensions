# Workflows

Organization-admin API for the runner's workflow configuration (`config_workers`,
`config_service_nodes`, `config_workflow_runs`). Everything goes through the platform
`workflows` driver (`self.params["drivers"]["workflows"]`), which scopes every call to the
verified organization and requires an organization administrator (403 otherwise).

- `/api/v1/workflows/Workflows/` GET list, `/<id>/` GET one, POST create, POST `/<id>/update`,
  POST `/<id>/enable` or `/disable`, POST `/<id>/delete` (plugin routes accept only GET and POST).
  Document: `name`, `group` (optional), `active`, `interval_seconds` (0 = manual, otherwise 10-86400), optional `cron` (5 fields; needs `interval_seconds` 0) and `timezone` (IANA, default UTC),
  `worker_node` (existing service node), `trigger` `{plugin, params}`, `workflow`
  `[{plugin, params, require_last_result?, always_run?}]` (1-20 steps) - the existing `config_workers` format.
- `/api/v1/workflows/WorkflowPlugins/` GET the installed worker plugins (`plugin`, `package`, `name`,
  `title`, `description`, `roles`, `editor`, `defaults`), `unavailable` workers with the reason, workflow
  fields, step flags and node names.
- `/api/v1/workflows/WorkflowRunNow/` POST `{workflow_id}` (or `/<id>/`) or `{plugin, params}` queues one run
  (202, `status: queued`, one per target, max 20 queued per organization). The `services` runner
  container executes it within seconds (see `TheFramework/api/README.md`).
- `/api/v1/workflows/WorkflowRuns/?workflow_id=&limit=` GET run history (newest first).

## Worker plugins

Triggers and steps are **worker plugins**, discovered by the platform (`system/modules/worker_catalog.py`):

- A service plugin `extensions/plugins/<package>/services/v1/Worker<Name>.py` with class `Worker<Name>`
  that declares `ORGANIZATION_SAFE = True` (and optionally `WORKER_ROLES = ("trigger",)`, `("step",)`;
  default both). It receives only the organization-bound database in `self.params["drivers"]["mongodb"]`.
- Its settings editor widget `extensions/plugins/<package>/widgets/v1/worker_<name>/`, where `<name>` is
  the snake_case form of `<Name>` (`WorkerPrometheusQuery` -> `worker_prometheus_query`). The manifest has
  `"role": "worker"` and its `defaultConfig` is the default settings of a new step. The widget's default
  export receives `{React, api, value, onChange, role, plugin}`: `value` is the step's `params`;
  `onChange(params, error)` reports new settings and a validation message (empty when valid) that blocks
  saving. Worker editors are not offered in the page editor.

Only workers that have their editor are offered; others are listed as `unavailable` with the reason.
Any other plugin name is refused (400) by the API and skipped by the runner, so the old reference
documents in `config_workers` (for example `database.Query`, `collectors.PrometheusQuery`) never run.

| Worker | Roles | Settings (editor) |
|---|---|---|
| `workflow_tools.WorkerStart` | trigger | `set` static fields (`worker_start`) |
| `workflow_tools.WorkerTransform` | trigger, step | `pick`, `set`, `limit` 0-10000 (`worker_transform`) |
| `database.WorkerMongoQuery` | trigger, step | `collection`, `query`, `projection`, `sort` `[{field, direction}]`, `limit` 1-1000 (`worker_mongo_query`) |
| `database.WorkerMongoInsert` | step | `collection`, `set` (`worker_mongo_insert`) |
| `database.WorkerMongoUpdate` | step | `collection`, `query`, `upsert` (`worker_mongo_update`) |

`${field}` (or `${a.b.0}`) in a database worker's `query` is filled from an item of the previous result
(WorkerMongoQuery: the first item; WorkerMongoUpdate: each item; the value keeps its type when the
string is exactly one placeholder). The legacy `database.Query`/`Insert`/`Update` and
`example.HelloWorld` open raw connections and are not workers.

## Built-in workflow page

TheApplication's **Manage -> Workflows** page (admin only, uses only the `workflows` API plugins) is laid out like the
ArcanistFrontend reaction manager: a quick-create row (name, group), a table with name, group, trigger,
step count, schedule, a clickable Enabled/Disabled badge and Edit/Run/History/Delete actions, and a side
panel editor with Settings / Trigger / Steps tabs. Trigger and steps are picked from worker cards, and
each one's settings are edited by the worker's own `worker_<name>` widget, loaded from
`/extensions/widgets.json` (a JSON editor is shown if it cannot be loaded). Steps are collapsible cards
with the worker editor plus "Require last result" and "Always run". "Run once" queues a workflow or a single plugin; history shows per-step
status, results and errors. The page client only does GET/POST, so updates and deletes use
`POST /Workflows/<id>/update` and `/delete`.

Workflow management is compiled into the main frontend, not loaded as a widget.
Worker settings editors remain dynamically loaded widgets with the same contract.
Standalone applications do not gain an organization administration menu.
The old `workflow-editor` widget is retained for compatibility with saved pages
and existing standalone frontends; it is no longer offered for new pages or
application widget selection. Existing workflow data and saved pages are unchanged.
The built-in page statically bundles this shared component, so it does not require
the workflow widget's catalog entry or a runtime module request. Worker settings
editors remain separate runtime extensions.

### Editing legacy workflows

Older workflows may reference non-worker service plugins such as `database.Query`.
The editor identifies them before saving and offers **Upgrade legacy workers** for
known, installed replacements: database Query/Insert/Update, TransformJson and
EnrichEvent. This is an explicit, in-editor change; nothing is persisted until
**Save workflow**. Nested settings, step order and execution flags are preserved.
Legacy unlimited, missing or above-1000 query limits become 1000, as disclosed
before upgrading. Review each replacement's settings and organization-scoped
behavior before saving. Unknown, unavailable or wrong-role replacements are never
guessed: choose a supported trigger or remove the unsupported step and add a worker.
The API and runner continue refusing unsafe legacy service plugins.

## Limitations

- Legacy `config_workers` entries without an organization are invisible by design; migrating them
  needs an operator-reviewed script with a verified backup.
