from uuid import UUID
from contextlib import contextmanager

import pytest

from backend.services import attack_paths


def test_demo_attack_paths_fall_back_when_neo4j_is_unavailable(monkeypatch):
    monkeypatch.setattr(
        attack_paths,
        "project_and_traverse",
        lambda *args, **kwargs: (_ for _ in ()).throw(ConnectionError("Neo4j unavailable")),
    )

    result = attack_paths.calculate_attack_paths(
        UUID("00000000-0000-0000-0000-000000000002"), demo=True
    )

    assert result["count"] == 8
    assert result["edge_count"] == len(attack_paths.DEMO_EDGES)
    assert result["graph_engine"] == "Deterministic SIH demo traversal"
    assert result["demo"] is True
    assert all(path["nodes"] and path["edges"] for path in result["paths"])
    targets = {path["nodes"][-1]["label"] for path in result["paths"]}
    assert {"Customer Orders Database", "Payment Records", "Customer Export Bucket", "Warehouse Orders"} <= targets
    assert len({node["label"] for path in result["paths"] for node in path["nodes"]}) >= 20

    default_path = result["paths"][0]
    assert [node["label"] for node in default_path["nodes"]] == [
        "Internet", "Public Store API", "Exposed API Credential",
        "Store Service Account", "Customer Orders Database",
    ]
    assert default_path["title"] == "Exposed API key → Customer orders"
    assert "could" in default_path["scenario_summary"]
    assert "Rotating the key" in default_path["scenario_summary"]
    assert all(path["demo"] and path["scenario_summary"] for path in result["paths"])
    assert all(node["description"] for path in result["paths"] for node in path["nodes"])

    shared_account_targets = {
        edge["target"] for path in result["paths"] for edge in path["edges"]
        if edge["source"] == "Store Service Account"
    }
    assert shared_account_targets == {
        "Customer Orders Database", "Payment Processing Service", "Customer Export Bucket",
    }
    for path in result["paths"]:
        assert len(path["edges"]) == len(path["nodes"]) - 1
        for index, edge in enumerate(path["edges"]):
            assert edge["source"] == path["nodes"][index]["id"]
            assert edge["target"] == path["nodes"][index + 1]["id"]


def test_live_attack_paths_do_not_substitute_demo_graph(monkeypatch):
    monkeypatch.setattr(
        attack_paths,
        "project_and_traverse",
        lambda *args, **kwargs: (_ for _ in ()).throw(ConnectionError("Neo4j unavailable")),
    )
    class FakeDatabase:
        def execute(self, *args, **kwargs):
            return self

        def fetchall(self):
            return []

    @contextmanager
    def fake_connection():
        yield FakeDatabase()

    monkeypatch.setattr(attack_paths, "get_connection", fake_connection)

    with pytest.raises(ConnectionError):
        attack_paths.calculate_attack_paths(
            UUID("00000000-0000-0000-0000-000000000001"), demo=False
        )


def test_live_paths_do_not_receive_demo_metadata(monkeypatch):
    # Even a live resource with the same name keeps its supplied title and data.
    records = attack_paths._traverse_demo_in_memory(attack_paths.DEMO_EDGES, 8)[:1]
    monkeypatch.setattr(attack_paths, "project_and_traverse", lambda *args, **kwargs: records)

    class FakeDatabase:
        def execute(self, *args, **kwargs):
            return self

        def fetchall(self):
            return []

    @contextmanager
    def fake_connection():
        yield FakeDatabase()

    monkeypatch.setattr(attack_paths, "get_connection", fake_connection)
    result = attack_paths.calculate_attack_paths(
        UUID("00000000-0000-0000-0000-000000000001"), demo=False
    )
    path = result["paths"][0]
    assert "demo" not in result
    assert "demo" not in path
    assert "scenario_summary" not in path
    assert path["title"] == "Internet → Customer Orders Database"
    assert all("description" not in node for node in path["nodes"])
