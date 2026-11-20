# health

Default framework package. `GET /public/v1/health/Status/` reports `api`,
`database` and `service_runner`, each `ok` or failing with a reason, plus the
framework version: 200 when all are ok, 503 otherwise. Used by the local smoke
test and the app server deployer's health check.
