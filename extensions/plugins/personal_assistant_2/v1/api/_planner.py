"""The day planner: rules only, no AI.

plan_for_date() is the one public way to make a plan. The Plan and Sync APIs call it, and
background workers import the same function:

    from extensions.plugins.personal_assistant_2.api.v1._planner import plan_for_date

Rules:
- Work tasks go in work time, private tasks outside it. Fixed blocks stay free.
- Must-dos and deadlines at a time today first, then deadlines within three days, then the rest.
- Each time frame is filled to about 70%. The one exception: a single task too long for that
  may take an otherwise empty frame, or it could never be planned at all.
- Done and started tasks keep their place. Nothing new is placed in the past.
- Open sub-tasks are placed instead of their parent.
- What does not fit is listed as unplanned, never dropped.
- Every open task is a candidate every day, so unfinished tasks roll over by themselves.
"""

import hashlib
import json
from datetime import timedelta

from extensions.plugins.personal_assistant_2.api.v1 import _core as core

FILL = 0.7
NEAR_DAYS = 3
REASONS = {
    "no_room": "The day is full enough",
    "no_work_time": "No work time on this day",
    "day_over": "No time left on this day",
}


def time_frames(schedule, day):
    """The day's broad blocks, in order."""
    wake = core.minutes(schedule["wake"])
    start, end = core.minutes(schedule["work_start"]), core.minutes(schedule["work_end"])
    bed = core.after(core.minutes(schedule["bedtime"]), wake)
    if core.DAYS[day.weekday()] not in schedule["workdays"]:
        return [{"name": "day", "label": "Day off", "context": "private", "start": wake, "end": bed}]
    frames = [
        {"name": "morning", "label": "Morning routine", "context": "private", "start": wake, "end": start},
        {"name": "work", "label": "Work", "context": "work", "start": start, "end": end},
        {"name": "evening", "label": "Evening", "context": "private", "start": end, "end": bed},
    ]
    return [frame for frame in frames if frame["end"] > frame["start"]]


def _without(segments, start, end):
    result = []
    for first, last in segments:
        if end <= first or start >= last:
            result.append((first, last))
            continue
        if first < start:
            result.append((first, start))
        if end < last:
            result.append((end, last))
    return result


def _length(segments):
    return sum(last - first for first, last in segments)


def _overlap(segments, start, end):
    return sum(max(0, min(last, end) - max(first, start)) for first, last in segments)


def _candidates(tasks):
    """Tasks the planner places: open sub-tasks stand in for their parent."""
    by_id = {task["id"]: task for task in tasks}
    split = {task["parent"] for task in tasks
             if task.get("parent") in by_id and task["status"] != "done"}
    result = []
    for task in tasks:
        if task["status"] != "done" and task["id"] in split:
            continue
        parent = by_id.get(task.get("parent")) or {}
        result.append(dict(task, deadline=task.get("deadline") or parent.get("deadline"),
                           must_do=bool(task.get("must_do") or parent.get("must_do")),
                           parent_title=parent.get("title")))
    return result


def _deadline(task):
    """(day ordinal, minute or None), or None."""
    value = task.get("deadline")
    if not value:
        return None
    minute = core.minutes(value[11:16]) if len(value) > 10 else None
    return core.parse_day(value[:10]).toordinal(), minute


def _order(task, day):
    due = _deadline(task)
    near = due is not None and due[0] - day.toordinal() <= NEAR_DAYS
    clocked = due is not None and due[0] == day.toordinal() and due[1] is not None
    group = 0 if task["status"] == "started" else 1 if task["must_do"] or clocked else 2 if near else 3
    when = (due[0], 1441 if due[1] is None else due[1]) if due else (10 ** 7, 0)
    return group, when, task.get("created_at") or "", task["id"]


def arrange(schedule, day, tasks, kept, now_minute=None):
    """Pure placement. kept: {task id: (start, end)} for done/started tasks, left exactly there.

    Returns (items, unplanned, frames) with minutes counted from the day's midnight.
    """
    frames = time_frames(schedule, day)
    wake = frames[0]["start"]
    blocks = [(core.after(core.minutes(block["start"]), wake), core.after(core.minutes(block["end"]), wake))
              for block in schedule["blocks"]]
    items = []
    for task in tasks:
        if task["id"] in kept:
            items.append((kept[task["id"]], task))
    for frame in frames:
        whole = [(frame["start"], frame["end"])]
        for first, last in blocks:
            whole = _without(whole, first, last)
        left = whole if now_minute is None else _without(whole, 0, now_minute)
        used = sum(_overlap(whole, *place) for place, _ in items)
        used_left = sum(_overlap(left, *place) for place, _ in items)
        frame["capacity"] = _length(whole)
        frame["budget"] = min(int(_length(whole) * FILL) - used, int(_length(left) * FILL) - used_left)
        frame["planned"] = used
        for place, _ in items:
            left = _without(left, *place)
        frame["free"] = left
    unplanned = []
    waiting = [task for task in _candidates(tasks) if task["status"] != "done" and task["id"] not in kept]
    for task in sorted(waiting, key=lambda row: _order(row, day)):
        own = [frame for frame in frames if frame["context"] == task["context"]]
        due = _deadline(task)
        limit = due[1] if due and due[0] == day.toordinal() else None
        place = _find(own, task["duration"], limit) or (_find(own, task["duration"], None) if limit is not None else None)
        if place is None:
            reason = ("no_work_time" if not own else
                      "no_room" if any(frame["free"] for frame in own) else "day_over")
            unplanned.append((task, reason))
            continue
        frame, start = place
        end = start + task["duration"]
        frame["free"] = _without(frame["free"], start, end)
        frame["budget"] -= task["duration"]
        frame["planned"] += task["duration"]
        items.append(((start, end), task))
    items.sort(key=lambda row: (row[0], row[1]["id"]))
    return items, unplanned, frames


def _find(frames, duration, limit):
    for frame in frames:
        alone = frame["planned"] == 0
        if frame["budget"] < duration and not alone:
            continue
        for first, last in frame["free"]:
            if last - first >= duration and (limit is None or first + duration <= limit):
                return frame, first
    return None


def _moment(value, day, schedule, requested_zone):
    """The minute on this plan's day for a stored time, or None if it was another day."""
    if not value:
        return None
    when, minute = core.local_day(core.parse_stamp(value), schedule, requested_zone)
    return minute if when == day else None


def _kept(tasks, previous, day, schedule, requested_zone):
    """Where done and started tasks already are on this day."""
    places = {item["task"]: (item["start_minute"], item["end_minute"])
              for item in (previous or {}).get("items", [])}
    candidates = {task["id"] for task in _candidates(tasks)}
    result = {}
    for task in tasks:
        if task["status"] not in ("started", "done") or (
                task["status"] == "started" and task["id"] not in candidates):
            continue
        started = _moment(task.get("started_at"), day, schedule, requested_zone)
        finished = _moment(task.get("finished_at"), day, schedule, requested_zone)
        if task["status"] == "done" and finished is None and task["id"] not in places:
            continue
        if task["status"] == "done" and task.get("finished_at") and finished is None:
            continue  # finished on another day: it belongs to that day's plan
        if task["id"] in places:
            result[task["id"]] = places[task["id"]]
        elif started is not None:
            result[task["id"]] = (started, started + task["duration"])
        elif task["status"] == "done":
            result[task["id"]] = (max(0, finished - task["duration"]), max(finished, 1))
    return result


def _frame_of(frames, start):
    for frame in frames:
        if frame["start"] <= start < frame["end"]:
            return frame["name"]
    return frames[0]["name"] if start < frames[0]["start"] else frames[-1]["name"]


def _basis(schedule, tasks):
    """Changes whenever something the plan depends on changes."""
    rows = sorted((task["id"], task.get("rev", 0)) for task in tasks)
    return hashlib.sha256(json.dumps([schedule, rows], sort_keys=True).encode()).hexdigest()[:24]


def _past(plan, tasks):
    """A day that is over: what got done. The rest simply moved on."""
    by_id = {task["id"]: task for task in tasks}
    plan = dict(plan)
    done = [item for item in plan["items"] if by_id.get(item["task"], {}).get("status") == "done"]
    plan["moved_on"] = [{"task": item["task"], "title": item["title"]} for item in plan["items"]
                        if item not in done and item["task"] in by_id]
    plan["items"] = [dict(item, status="done") for item in done]
    plan["unplanned"] = []
    return plan


def plan_for_date(db, space, day=None, now=None, *, replan=False, store=True, requested_zone=None):
    """Make (or reuse) the plan for a date in one space. The only public planner function.

    day: datetime.date, default the user's current day. replan: make it again even when nothing
    changed, moving what was not started to the time that is left. store=False: a preview.
    The caller must have checked that the user belongs to the space.
    """
    now = now or core.utcnow()
    schedule, saved = core.load_schedule(db, space)
    today, minute = core.local_day(now, schedule, requested_zone)
    day = day or today
    tasks = [task for task in db.get_collection(core.TASKS).find({"space": space, "deleted": False})]
    plans = db.get_collection(core.PLANS)
    key = f"{space}|{day.isoformat()}"
    previous = plans.find_one({"_id": key})
    if day < today:
        if previous is None:
            return _view({"date": day.isoformat(), "space": space, "items": [], "unplanned": [], "frames": [],
                          "made_at": None, "schedule_saved": saved})
        return _view(_past(previous, tasks))
    basis = _basis(schedule, tasks)
    if previous is not None and previous.get("basis") == basis and not replan:
        return _view(previous)

    kept = _kept(tasks, previous, day, schedule, requested_zone)
    placed, left_over, frames = arrange(schedule, day, tasks, kept, minute if day == today else None)
    effective = {task["id"]: task for task in _candidates(tasks)}
    carried = _carried(plans, space, day)

    def describe(task):
        shown = effective.get(task["id"], task)
        return {"task": task["id"], "title": task["title"], "context": task["context"],
                "duration": task["duration"], "status": task["status"], "must_do": bool(shown.get("must_do")),
                "deadline": shown.get("deadline"), "parent": task.get("parent"),
                "parent_title": shown.get("parent_title"),
                "carried_from": carried.get(task["id"]) if task["status"] != "done" else None}

    plan = {
        "space": space, "date": day.isoformat(), "made_at": core.stamp(now), "basis": basis,
        "schedule_saved": saved,
        "frames": [{"name": frame["name"], "label": frame["label"], "context": frame["context"],
                    "start": core.hhmm(frame["start"]), "end": core.hhmm(frame["end"]),
                    "capacity": frame["capacity"], "planned": frame["planned"]} for frame in frames],
        "blocks": schedule["blocks"],
        "items": [dict(describe(task), start=core.hhmm(start), end=core.hhmm(end), start_minute=start,
                       end_minute=end, frame=_frame_of(frames, start)) for (start, end), task in placed],
        "unplanned": [dict(describe(task), reason=reason, reason_text=REASONS[reason])
                      for task, reason in left_over],
    }
    if store:
        plans.update_one({"_id": key}, {"$set": plan}, upsert=True)
    return _view(plan)


def _carried(plans, space, day):
    """{task id: the latest earlier date it was planned on}. A neutral fact, not a failure."""
    result = {}
    first = (day - timedelta(days=14)).isoformat()
    for plan in plans.find({"space": space, "date": {"$gte": first, "$lt": day.isoformat()}}):
        for item in plan["items"]:
            if plan["date"] > result.get(item["task"], ""):
                result[item["task"]] = plan["date"]
    return result


def _view(plan):
    return {key: value for key, value in plan.items() if key not in ("_id", "organization_id", "basis")}
