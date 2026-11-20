# Email sender worker

`email_sender.WorkerSendEmail` is a workflow step paired with the
`worker_send_email` settings editor. Configure SMTP, vault entry name, sender,
recipients, subject and message. Passwords are resolved only at execution time.

Enable **Include last result** (`include_last_result: true`) to append the entire
previous step result as formatted JSON to the message. It defaults to false,
including for existing saved workflows. Multiple trigger records are included,
not only the first. No result (`null`) adds nothing; empty lists/objects are
included when explicitly provided. Serialization failures stop before SMTP.
Only enable this for data the configured recipients are permitted to receive.

Subject/message templates such as `${title}`, `${phase}` and `${job_id}` use
the first object of a list result, or a directly supplied object. Nested paths
such as `${build.status}` are supported. Missing paths fail validation at send
time. Vault passwords are never added to the result or message by the worker.

The state watcher emits a list of matching record objects, preserving the build
fields present in those records (including nested fields), converting IDs/dates
to JSON-safe strings and removing the top-level organization ID. The workflow
runner passes these objects to the next step unchanged. No new fields are
invented when a build record does not contain them.
