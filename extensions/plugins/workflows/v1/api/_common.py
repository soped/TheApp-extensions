"""Shared helpers for the workflow plugins."""

from system.modules import crud_access


def workflows_driver(api_params):
    driver = (api_params.get("drivers") or {}).get("workflows")
    if driver is None:
        raise crud_access.AccessDenied("Workflow administration is not available", 503)
    return driver


def body_of(params):
    body = (params or {}).get("json")
    return body if isinstance(body, dict) else {}


def arg(params, name):
    value = ((params or {}).get("args") or {}).get(name)
    if isinstance(value, (list, tuple)):
        value = value[0] if value else None
    return value


def dynamic_of(params):
    return [part for part in ((params or {}).get("kwargs") or {}).get("dynamic") or [] if part]
