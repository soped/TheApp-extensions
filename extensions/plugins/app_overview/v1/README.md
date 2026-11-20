# app_overview

Default frontend package. The `app-overview` widget lists the organization's
deployed apps (name and address, version, image digest, database mode, status
from the deployer) using `GET /api/v1/builder_activity/Apps/`. Administrators
delete an app after typing its name; that only marks the deployment record
(`POST .../Apps/State/ {state: "deleted"}`), and the app server's deployer
removes everything. In an app without a deployment registry it says so.
