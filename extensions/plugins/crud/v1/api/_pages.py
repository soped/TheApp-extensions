"""Validation for widget pages and new-tab navigation links."""

import re
from urllib.parse import urlsplit

from system.modules import crud_access


def validate_page(page):
    if set(page) - {"_id", "organization_id", "title", "slug", "widgets", "type", "url"}:
        raise crud_access.AccessDenied("Unknown page fields", 400)
    title = page.get("title")
    slug = page.get("slug")
    widgets = page.get("widgets")
    if not isinstance(title, str) or not title.strip() or len(title) > 120:
        raise crud_access.AccessDenied("Page title is required (up to 120 characters)", 400)
    if not isinstance(slug, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) or len(slug) > 80:
        raise crud_access.AccessDenied("Page slug must be lowercase words separated by hyphens", 400)
    page_type = page.get("type", "widgets")
    if page_type not in ("widgets", "link"):
        raise crud_access.AccessDenied("Page type must be widgets or link", 400)
    if page_type == "link":
        url = page.get("url")
        if not isinstance(url, str) or not url or len(url) > 2048 or any(character.isspace() or ord(character) < 32 for character in url) or "\\" in url:
            raise crud_access.AccessDenied("Provide an absolute HTTP or HTTPS URL (up to 2048 characters)", 400)
        try:
            parsed = urlsplit(url)
            valid = parsed.scheme in ("http", "https") and parsed.hostname and not parsed.username and not parsed.password
            parsed.port
        except ValueError:
            valid = False
        if not valid:
            raise crud_access.AccessDenied("Provide an absolute HTTP or HTTPS URL without embedded credentials", 400)
        if widgets != []:
            raise crud_access.AccessDenied("Link pages cannot contain widgets", 400)
    elif page.get("url", "") != "":
        raise crud_access.AccessDenied("Widget pages cannot have a link URL", 400)
    if not isinstance(widgets, list) or len(widgets) > 50:
        raise crud_access.AccessDenied("widgets must be an array of at most 50 entries", 400)
    ids = set()
    for widget in widgets:
        if not isinstance(widget, dict) or set(widget) != {"id", "widget", "config", "width"}:
            raise crud_access.AccessDenied("Each widget needs id, widget, config and width", 400)
        for field in ("id", "widget"):
            if not isinstance(widget[field], str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", widget[field]):
                raise crud_access.AccessDenied(f"Invalid widget {field}", 400)
        if widget["id"] in ids:
            raise crud_access.AccessDenied("Widget instance ids must be unique", 400)
        ids.add(widget["id"])
        if not isinstance(widget["config"], dict) or type(widget["width"]) is not int or widget["width"] not in (1, 2, 3):
            raise crud_access.AccessDenied("Widget config must be an object and width must be 1, 2 or 3", 400)
