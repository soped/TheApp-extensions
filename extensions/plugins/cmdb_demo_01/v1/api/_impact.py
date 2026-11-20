"""Blast radius: which items go down or degrade when a set of items fails.

Traversal uses the tenant driver's bounded ``$graphLookup`` (four hops per call)
and continues from incomplete frontier nodes, so long chains are followed while
visited sets keep cycles finite. Only ``depends`` links are followed; ``owns``
and ``redundant`` links are returned by ``$graphLookup`` but never traversed.

Redundancy rule: a dependency link with a group (e.g. "core") belongs to that
redundant group. A group is down only if every source in it is down; otherwise
a down or degraded source degrades the target. A link without a group is its
own group of one: a down source takes the target down. Environments are
isolated: a failure never crosses from one environment into another (prod
failures never affect test).
"""

from collections import defaultdict, deque

LOOKUP_DEPTH = 4         # tenant driver maximum per $graphLookup call
MAX_ROUNDS = 25          # continuation lookups per analysis
MAX_NODES = 2000         # safety bound on the traversed graph
RANK = {"up": 0, "degraded": 1, "down": 2}


def evaluate(failed, edges, environment=None):
    """Pure redundancy evaluation.

    failed: iterable of node keys that are down.
    edges: iterable of (source, target, group) depends links (group None = not redundant).
    environment: optional {node: env}; links across environments are ignored.
    Returns {node: {"state": "down"|"degraded", "via": [...], "covered": [...], "depth": n}}
    for every affected node except the failed ones. Monotone fixpoint: cycles terminate.
    """
    failed = set(failed)
    environment = environment or {}
    incoming = defaultdict(lambda: defaultdict(set))
    outgoing = defaultdict(set)
    for source, target, group in edges:
        if source == target:
            continue
        if environment.get(source) and environment.get(target) and environment[source] != environment[target]:
            continue
        incoming[target][group or ("solo", source)].add(source)
        outgoing[source].add(target)

    # Only nodes reachable from a failure can change; breadth-first gives the hop depth.
    depth, queue = {}, deque((node, 0) for node in sorted(failed))
    seen = set(failed)
    while queue:
        node, hops = queue.popleft()
        for target in sorted(outgoing[node]):
            if target not in seen:
                seen.add(target)
                depth[target] = hops + 1
                queue.append((target, hops + 1))

    state = {node: "down" for node in failed}
    reachable = [node for node in depth if node not in failed]
    changed = True
    rounds = 0
    while changed and rounds <= len(reachable) * 2 + 2:
        changed, rounds = False, rounds + 1
        for node in reachable:
            worst = "up"
            for group, sources in incoming[node].items():
                states = [state.get(source, "up") for source in sources]
                if all(value == "down" for value in states):
                    level = "down"
                elif any(value != "up" for value in states):
                    level = "degraded"
                else:
                    continue
                if RANK[level] > RANK[worst]:
                    worst = level
            if RANK[worst] > RANK[state.get(node, "up")]:
                state[node] = worst
                changed = True

    result = {}
    for node in reachable:
        if state.get(node, "up") == "up":
            continue
        via, covered = set(), []
        for group, sources in sorted(incoming[node].items(), key=lambda pair: str(pair[0])):
            hit = sorted(source for source in sources if state.get(source, "up") != "up")
            via.update(hit)
            if not isinstance(group, tuple) and hit and len(hit) < len(sources):
                covered.append({"group": group, "down": sorted(s for s in sources if state.get(s) == "down"),
                                "up": sorted(s for s in sources if state.get(s, "up") == "up")})
        result[node] = {"state": state[node], "via": sorted(via), "covered": covered, "depth": depth[node]}
    return result


def collect_edges(relations, starts):
    """Edges reachable downstream of ``starts`` (ObjectIds) via the bounded tenant $graphLookup.

    Returns (depends edges reachable from the starts, by _id; truncated). A node's outgoing edges are known once it
    was a lookup start or was reached within LOOKUP_DEPTH - 1 hops of one;
    remaining depends-reachable nodes are looked up in further rounds.
    """
    edges, complete, looked = {}, set(), set()
    frontier = set(starts)
    rounds = 0
    reachable_edges = {}
    while frontier:
        if rounds >= MAX_ROUNDS or len(complete) > MAX_NODES:
            return reachable_edges, True
        rounds += 1
        for start in sorted(frontier, key=str):
            looked.add(start)
            complete.add(start)
            for edge in relations.graph_lookup(start, connect_from_field="target_id",
                                               connect_to_field="source_id", max_depth=LOOKUP_DEPTH):
                edges.setdefault(edge["_id"], edge)
                if int(edge.get("graph_depth", LOOKUP_DEPTH)) <= LOOKUP_DEPTH - 2:
                    complete.add(edge["target_id"])
        # Only depends links propagate failures; owns/redundant edges found by $graphLookup are dropped.
        by_source = defaultdict(list)
        for edge in edges.values():
            if edge.get("type") == "depends":
                by_source[edge["source_id"]].append(edge)
        reachable, queue, reachable_edges = set(starts), deque(starts), {}
        while queue:
            for edge in by_source[queue.popleft()]:
                reachable_edges[edge["_id"]] = edge
                if edge["target_id"] not in reachable:
                    reachable.add(edge["target_id"])
                    queue.append(edge["target_id"])
        frontier = {node for node in reachable if node not in complete and node not in looked}
    return reachable_edges, False


def analyze(relations, items_by_id, failed_ids):
    """Impact of failing ``failed_ids`` given relation/item collections; returns evaluation by item key."""
    failed_ids = [item_id for item_id in failed_ids if item_id in items_by_id]
    if not failed_ids:
        return {}, False
    edges, truncated = collect_edges(relations, failed_ids)
    downstream = {edge["target_id"] for edge in edges.values()}
    # Redundancy needs every upstream of an affected item, including sources still up.
    links = list(relations.find({"type": "depends", "target_id": {"$in": sorted(downstream, key=str)}}))
    links += list(edges.values())
    unique = {}
    for link in links:
        unique.setdefault(link["_id"], link)
    key = {item_id: doc["key"] for item_id, doc in items_by_id.items()}
    triples = [(key[link["source_id"]], key[link["target_id"]], link.get("group") or None)
               for link in unique.values() if link["source_id"] in key and link["target_id"] in key]
    environment = {doc["key"]: doc.get("environment") for doc in items_by_id.values()}
    return evaluate({key[item_id] for item_id in failed_ids}, triples, environment), truncated
