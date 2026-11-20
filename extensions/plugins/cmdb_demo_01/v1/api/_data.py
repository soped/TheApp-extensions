"""Canonical CMDB demo 01 mock dataset (all made-up) and its expected scenario results.

Source: the note of the board task "Seed mock data into local MongoDB". Pure data,
no imports, so the API plugins, the local seed script and the tests share it.
"""

TEAMS = (
    {"key": "team-platform", "name": "Platform Team", "scope": "network, web/app servers, test infra, wiki"},
    {"key": "team-data", "name": "Data Team", "scope": "database server, databases, reporting"},
    {"key": "team-app", "name": "App Team", "scope": "Webshop, Order API"},
)

# key, type, subtype, owner, environment, status, notes, ip
_ITEMS = (
    ("sw-core-01", "switch", "", "team-platform", "prod", "operational",
     "core switch, VLAN 10/20, redundant pair with sw-core-02", ""),
    ("sw-core-02", "switch", "", "team-platform", "prod", "operational",
     "core switch, redundant pair with sw-core-01", ""),
    ("sw-access-01", "switch", "", "team-platform", "prod", "operational",
     "access switch, uplinks to both core switches", ""),
    ("sw-test-01", "switch", "", "team-platform", "test", "operational", "isolated test switch", ""),
    ("srv-web-01", "server", "", "team-platform", "prod", "operational", "web server", "10.0.10.11"),
    ("srv-app-01", "server", "", "team-platform", "prod", "operational", "application server", "10.0.10.21"),
    ("srv-db-01", "server", "", "team-data", "prod", "degraded", "database server, disk 85%", "10.0.20.31"),
    ("srv-test-01", "server", "", "team-platform", "test", "operational", "test server", "10.0.90.11"),
    ("db-orders", "database", "PostgreSQL", "team-data", "prod", "operational", "on srv-db-01", ""),
    ("db-users", "database", "MySQL", "team-data", "prod", "operational", "on srv-db-01", ""),
    ("db-orders-test", "database", "PostgreSQL", "team-data", "test", "operational", "on srv-test-01", ""),
    ("app-webshop", "application", "", "team-app", "prod", "operational", "Webshop frontend, calls Order API", ""),
    ("app-order-api", "application", "", "team-app", "prod", "operational", "Order API", ""),
    ("app-reporting", "application", "", "team-data", "prod", "maintenance", "nightly reporting batch job", ""),
    ("app-wiki", "application", "", "team-platform", "prod", "operational", "Internal Wiki, no database", ""),
    ("app-order-api-test", "application", "", "team-app", "test", "operational", "test instance of Order API", ""),
)

ITEMS = tuple(
    {"key": key, "name": key, "type": kind, "subtype": subtype, "owner": owner, "environment": environment,
     "status": status, "notes": notes, "ip": ip}
    for key, kind, subtype, owner, environment, status, notes, ip in _ITEMS
)

# source -> target: the target depends on the source. Third value: redundant group or None.
DEPENDS = (
    ("sw-core-01", "sw-access-01", "core"),
    ("sw-core-02", "sw-access-01", "core"),
    ("sw-core-01", "srv-db-01", "core"),
    ("sw-core-02", "srv-db-01", "core"),
    ("sw-access-01", "srv-web-01", None),
    ("sw-access-01", "srv-app-01", None),
    ("sw-test-01", "srv-test-01", None),
    ("srv-db-01", "db-orders", None),
    ("srv-db-01", "db-users", None),
    ("srv-test-01", "db-orders-test", None),
    ("srv-web-01", "app-webshop", None),
    ("srv-web-01", "app-wiki", None),
    ("srv-app-01", "app-order-api", None),
    ("srv-app-01", "app-reporting", None),
    ("srv-test-01", "app-order-api-test", None),
    ("db-orders", "app-order-api", None),
    ("db-users", "app-order-api", None),
    ("db-orders", "app-reporting", None),
    ("db-orders-test", "app-order-api-test", None),
    ("app-order-api", "app-webshop", None),
)

# Redundant pair: not a dependency, never traversed by impact (so it cannot form a cycle).
REDUNDANT = (("sw-core-01", "sw-core-02", "redundant pair"),)


def relations():
    """All relations as dicts: depends, redundant, and owns (team -> item it owns)."""
    found = [{"source": source, "target": target, "type": "depends", "group": group,
              "label": f"redundant uplink ({group})" if group else "depends on"}
             for source, target, group in DEPENDS]
    found += [{"source": source, "target": target, "type": "redundant", "group": None, "label": label}
              for source, target, label in REDUNDANT]
    found += [{"source": item["owner"], "target": item["key"], "type": "owns", "group": None, "label": "owns"}
              for item in ITEMS]
    return found


SCENARIOS = {
    "core-switch": {"title": "One core switch down", "items": ("sw-core-01",)},
    "db-server": {"title": "Database server down", "items": ("srv-db-01",)},
    "both-core": {"title": "Both core switches down", "items": ("sw-core-01", "sw-core-02")},
}

# Exact expected results from the task note; the tests assert them.
EXPECTED = {
    "core-switch": {
        "down": set(),
        "degraded": {"sw-access-01", "srv-db-01", "srv-web-01", "srv-app-01", "db-orders", "db-users",
                     "app-webshop", "app-order-api", "app-reporting", "app-wiki"},
        "summary": "sw-core-01 down, failover active, 10 items degraded, Platform Team",
    },
    "db-server": {
        "down": {"db-orders", "db-users", "app-order-api", "app-reporting", "app-webshop"},
        "degraded": set(),
        "owners": {"Data Team", "App Team"},
    },
    "both-core": {
        "down": {"sw-access-01", "srv-db-01", "srv-web-01", "srv-app-01", "db-orders", "db-users",
                 "app-webshop", "app-order-api", "app-reporting", "app-wiki"},
        "degraded": set(),
    },
}
