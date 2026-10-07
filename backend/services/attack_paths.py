"""Evidence-derived attack reachability traversed in Neo4j."""

import json

from backend.database.connection import get_connection
from backend.services.neo4j_graph import project_and_traverse


def _demo_edge(edge_id, source, target, relation, source_kind, target_kind, confidence, impact=0):
    return {
        "external_edge_id": f"demo-{edge_id}", "source_name": "SIH online-store demo",
        "source_node": source, "target_node": target, "relation_type": relation,
        "source_kind": source_kind, "target_kind": target_kind, "confidence": confidence,
        "evidence": {"financial_impact_inr": impact} if impact else {},
    }


# One fictional online store, with shared resources and eight business targets.
# These are illustrative relationship records, never substitutes for live evidence.
DEMO_EDGES = [
    _demo_edge(1, "Internet", "Public Store API", "publicly reachable", "INTERNET", "API", .98),
    _demo_edge(2, "Public Store API", "Exposed API Credential", "credential exposed", "API", "VULNERABILITY", .95),
    _demo_edge(3, "Exposed API Credential", "Store Service Account", "authenticates as", "VULNERABILITY", "IDENTITY", .94),
    _demo_edge(4, "Store Service Account", "Customer Orders Database", "can read customer orders", "IDENTITY", "CRITICAL_ASSET", .93, 78500000),
    _demo_edge(5, "Store Service Account", "Payment Processing Service", "can manage payments", "IDENTITY", "COMPUTE", .90),
    _demo_edge(6, "Payment Processing Service", "Payment Records", "can read and update payments", "COMPUTE", "CRITICAL_ASSET", .89, 101000000),
    _demo_edge(7, "Store Service Account", "Customer Export Bucket", "can download customer exports", "IDENTITY", "CROWN_JEWEL", .87, 124000000),
    _demo_edge(8, "Public Store API", "Customer Support Portal", "routes support requests", "API", "API", .88),
    _demo_edge(9, "Customer Support Portal", "Support Service Account", "uses support account", "API", "IDENTITY", .86),
    _demo_edge(10, "Support Service Account", "Customer Profiles", "can view customer profiles", "IDENTITY", "CROWN_JEWEL", .84, 68000000),
    _demo_edge(11, "Internet", "Store Admin Login", "publicly reachable", "INTERNET", "API", .92),
    _demo_edge(12, "Store Admin Login", "Missing Admin MFA", "missing second factor", "API", "VULNERABILITY", .88),
    _demo_edge(13, "Missing Admin MFA", "Store Administrator", "password-only access", "VULNERABILITY", "IDENTITY", .85),
    _demo_edge(14, "Store Administrator", "Order Fulfillment Service", "can manage fulfillment", "IDENTITY", "COMPUTE", .83),
    _demo_edge(15, "Order Fulfillment Service", "Warehouse Orders", "can change delivery orders", "COMPUTE", "CRITICAL_ASSET", .81, 54000000),
    _demo_edge(16, "Store Administrator", "Product Pricing Catalog", "can change product prices", "IDENTITY", "CRITICAL_ASSET", .79, 62000000),
    _demo_edge(17, "Internet", "Supplier Upload Portal", "accepts supplier uploads", "INTERNET", "API", .86),
    _demo_edge(18, "Supplier Upload Portal", "Unvalidated Uploads", "upload validation gap", "API", "VULNERABILITY", .80),
    _demo_edge(19, "Unvalidated Uploads", "Inventory Import Worker", "files processed by", "VULNERABILITY", "COMPUTE", .76),
    _demo_edge(20, "Inventory Import Worker", "Inventory Database", "can update stock levels", "COMPUTE", "CRITICAL_ASSET", .74, 92000000),
    _demo_edge(21, "Internet", "Store Deployment Webhook", "public deployment endpoint", "INTERNET", "API", .85),
    _demo_edge(22, "Store Deployment Webhook", "Exposed Deployment Token", "deployment token exposed", "API", "VULNERABILITY", .79),
    _demo_edge(23, "Exposed Deployment Token", "Deployment Service Account", "authenticates as", "VULNERABILITY", "IDENTITY", .75),
    _demo_edge(24, "Deployment Service Account", "Production Store Backend", "can deploy application", "IDENTITY", "COMPUTE", .72),
    _demo_edge(25, "Production Store Backend", "Backup Export Service", "uses backup service", "COMPUTE", "COMPUTE", .70),
    _demo_edge(26, "Backup Export Service", "Store Backup Bucket", "can read store backups", "COMPUTE", "CROWN_JEWEL", .68, 88000000),
]

DEMO_NODE_DESCRIPTIONS = {
    "Internet": "An outsider starts outside the store's trusted environment. This example illustrates possible reachability, not an attack in progress.",
    "Public Store API": "The storefront's public API accepts customer requests. In this fictional example, an API credential is exposed here.",
    "Exposed API Credential": "A leaked API key could be reused until it is revoked. Rotate the key and remove the source of exposure to interrupt this route.",
    "Store Service Account": "The store's application identity has more access than it needs: orders, payments, and customer exports. A stolen key could inherit those permissions.",
    "Customer Orders Database": "Customer names, delivery addresses, and order history. An outsider using the service account could read these records; narrow the account's permissions.",
    "Payment Processing Service": "Processes the store's payments. The same service account can manage it, creating a second potential branch from the exposed key.",
    "Payment Records": "Payment and refund records. Excessive service access could allow unauthorized reading or changes, affecting revenue and reconciliation.",
    "Customer Export Bucket": "Files containing customer exports. Download permission on the shared service account could expose many customers at once.",
    "Customer Support Portal": "Support requests are routed from the store API to this portal. Confirm authentication and authorization before treating the connection as exploitable.",
    "Support Service Account": "The support portal's identity can view customer profiles. Restrict its access to the records required for support.",
    "Customer Profiles": "Customer contact details and profile information. A compromised support identity could expose these records.",
    "Store Admin Login": "The store's administration sign-in is reachable from the Internet. Public reachability alone does not establish unauthorized access.",
    "Missing Admin MFA": "The fictional admin login lacks a second factor. A stolen password could be sufficient to sign in; enforcing MFA would interrupt this route.",
    "Store Administrator": "An administrative identity can control fulfillment and product prices. Limit privileges and protect sign-in with MFA.",
    "Order Fulfillment Service": "Schedules delivery orders for the warehouse. Administrative access could allow disruption or fraudulent changes.",
    "Warehouse Orders": "Delivery instructions and fulfillment records. Unauthorized changes could delay orders or redirect shipments.",
    "Product Pricing Catalog": "Product prices used by the storefront. An unauthorized administrator could change prices and affect revenue.",
    "Supplier Upload Portal": "Suppliers submit stock files here. The entry route depends on the supplier authentication and upload controls actually in place.",
    "Unvalidated Uploads": "The fictional upload flow lacks content validation. A harmful file could reach the inventory import process; validate and isolate incoming files.",
    "Inventory Import Worker": "Processes supplier files and updates inventory. Assess whether a harmful upload could affect this worker before assuming exploitation.",
    "Inventory Database": "Stock levels used to accept and fulfill orders. Excessive worker permissions could allow unauthorized changes and disrupt sales.",
    "Store Deployment Webhook": "A public endpoint triggers deployment workflows. Verify its authentication and scope before assuming an outsider can use it.",
    "Exposed Deployment Token": "A leaked deployment token could be reused to authenticate as the deployment account. Revoke it and remove the exposure.",
    "Deployment Service Account": "The deployment identity can release the store application. Scope the token and account to the minimum required deployment actions.",
    "Production Store Backend": "Runs the store application and connects to the backup workflow. A compromised deployment could potentially affect this service.",
    "Backup Export Service": "Exports backups for the store backend. Restrict which workloads can use it and audit backup access.",
    "Store Backup Bucket": "Backup copies of store data. A compromised backup service could expose records beyond the production database.",
}

DEMO_SCENARIOS = {
    "Customer Orders Database": (
        "Exposed API key → Customer orders",
        "An exposed API key could let an outsider use an overprivileged service account to read customer orders. Rotating the key and narrowing the account's permissions would break this route.",
    ),
    "Payment Records": (
        "Exposed API key → Payment records",
        "The same exposed API key could also grant access to the payment service and its records. Rotate the key and remove unnecessary payment permissions from the shared account.",
    ),
    "Customer Export Bucket": (
        "Exposed API key → Customer exports",
        "The shared service account can download customer exports. An outsider reusing its exposed key could reach those files; revoke the key and restrict export access.",
    ),
    "Customer Profiles": (
        "Support access → Customer profiles",
        "The public store API connects to the support portal and its customer-profile access. Validate each authentication boundary before treating this route as exploitable, and limit the support account's permissions.",
    ),
    "Warehouse Orders": (
        "Missing admin MFA → Delivery orders",
        "A stolen admin password could allow access without a second factor and lead to delivery-order changes. Require MFA and limit administrative fulfillment permissions.",
    ),
    "Product Pricing Catalog": (
        "Missing admin MFA → Product prices",
        "The same password-only administrative access could allow product-price changes. Enforcing MFA and separating pricing privileges would interrupt this route.",
    ),
    "Inventory Database": (
        "Unsafe supplier upload → Inventory",
        "An unvalidated supplier file could reach the inventory worker and potentially affect stock records. Validate uploads, isolate processing, and restrict the worker's database permissions.",
    ),
    "Store Backup Bucket": (
        "Exposed deployment token → Store backups",
        "A reused deployment token could affect the production application and potentially its backup access. Revoke the token, restrict deployment privileges, and separate backup permissions.",
    ),
}


def _node_type(kind: str) -> str:
    mapping = {"INTERNET": "internet", "EXTERNAL": "internet", "UNTRUSTED": "internet", "API": "api", "IDENTITY": "identity", "DATABASE": "database", "CRITICAL_ASSET": "database", "CROWN_JEWEL": "data", "VULNERABILITY": "vulnerability"}
    return mapping.get(kind.upper(), "compute")


def _format_paths(records: list[dict]) -> dict:
    paths = []
    for record in records:
        raw_nodes = record["nodes"]
        confidence = float(record["confidence"])
        severity = "CRITICAL" if confidence >= .8 else "HIGH" if confidence >= .6 else "MEDIUM"
        nodes = [{"id": node["name"], "label": node["name"], "type": _node_type(node.get("kind") or "COMPUTE"), "severity": None if index == 0 else severity, "x": 90 + index * 185, "y": 165 + (index % 2) * 55} for index, node in enumerate(raw_nodes)]
        edges, impact = [], 0.0
        for edge_index, edge in enumerate(record["edges"]):
            evidence = json.loads(edge.get("evidence_json") or "{}")
            impact = max(impact, float(evidence.get("financial_impact_inr") or edge.get("financial_impact_inr") or 0))
            edges.append({"id": edge["edge_id"], "source": raw_nodes[edge_index]["name"], "target": raw_nodes[edge_index + 1]["name"], "label": edge.get("relation_type", "Reachable").replace("_", " "), "risky": True})
        paths.append({"id": "path-" + "-".join(edge["id"] for edge in edges), "title": f'{raw_nodes[0]["name"]} → {raw_nodes[-1]["name"]}', "severity": severity, "risk_score": round(confidence * 100), "confidence": confidence, "nodes": nodes, "edges": edges, "financial_impact_inr": impact})
    return {"paths": paths, "count": len(paths), "graph_engine": "Neo4j", "provenance": "current organization-supplied relationship evidence"}


def _traverse_demo_in_memory(rows: list[dict], max_depth: int) -> list[dict]:
    """Deterministic offline fallback for the explicitly labelled SIH demo.

    Live organizations never use this path. It keeps the golden demo usable
    when the optional Neo4j container is unavailable while retaining the same
    edge evidence and traversal semantics.
    """
    adjacency: dict[str, list[dict]] = {}
    node_kinds: dict[str, str] = {}
    for raw in rows:
        edge = dict(raw)
        adjacency.setdefault(edge["source_node"], []).append(edge)
        node_kinds[edge["source_node"]] = edge.get("source_kind") or "COMPUTE"
        node_kinds[edge["target_node"]] = edge.get("target_kind") or "COMPUTE"

    entries = [name for name, kind in node_kinds.items() if str(kind).upper() in {"INTERNET", "EXTERNAL", "UNTRUSTED"}]
    records: list[dict] = []

    def walk(node: str, path_nodes: list[str], path_edges: list[dict]) -> None:
        if len(path_edges) >= max_depth:
            return
        for raw in adjacency.get(node, []):
            target = raw["target_node"]
            if target in path_nodes:
                continue
            evidence = raw.get("evidence") or {}
            edge = {
                "edge_id": str(raw["external_edge_id"]),
                "relation_type": raw.get("relation_type") or "REACHES",
                "confidence": float(raw.get("confidence") or 0),
                "evidence_json": json.dumps(evidence, default=str),
                "financial_impact_inr": float(evidence.get("financial_impact_inr") or 0),
            }
            next_nodes = [*path_nodes, target]
            next_edges = [*path_edges, edge]
            if str(node_kinds.get(target, "")).upper() in {"CROWN_JEWEL", "CRITICAL_ASSET"}:
                records.append({
                    "nodes": [{"name": name, "kind": node_kinds.get(name, "COMPUTE")} for name in next_nodes],
                    "edges": next_edges,
                    "confidence": min(item["confidence"] for item in next_edges),
                })
            walk(target, next_nodes, next_edges)

    for entry in entries:
        walk(entry, [entry], [])
    records.sort(key=lambda record: record["confidence"], reverse=True)
    return records


def calculate_attack_paths(organization_id, max_depth: int = 8, demo: bool = False) -> dict:
    if demo:
        rows = DEMO_EDGES
    else:
        with get_connection() as db:
            rows = db.execute("""SELECT external_edge_id,source_name,source_node,target_node,relation_type,source_kind,target_kind,confidence,evidence FROM relationship_edges WHERE organization_id=%s AND observed_at<=NOW() AND (valid_until IS NULL OR valid_until>NOW()) ORDER BY source_node,target_node""", (organization_id,)).fetchall()
    graph_engine = "Neo4j"
    try:
        records = project_and_traverse(organization_id, [dict(row) for row in rows], max_depth)
    except Exception:
        if not demo:
            raise
        records = _traverse_demo_in_memory([dict(row) for row in rows], max_depth)
        graph_engine = "Deterministic SIH demo traversal"
    response = _format_paths(records)
    response["graph_engine"] = graph_engine
    response["provenance"] = "bundled SIH demo relationship evidence" if demo else "current organization-supplied relationship evidence"
    response["edge_count"] = len(rows)
    response["limitations"] = ["Reachability is evidence-based and does not prove exploitability", "Missing edges produce incomplete paths rather than synthetic links"]
    if demo:
        response["demo"] = True
        for path in response["paths"]:
            path["demo"] = True
            title, summary = DEMO_SCENARIOS.get(path["nodes"][-1]["label"], (path["title"], ""))
            path["title"] = title
            path["scenario_summary"] = summary
            for node in path["nodes"]:
                node["description"] = DEMO_NODE_DESCRIPTIONS.get(node["id"], "")
    return response
