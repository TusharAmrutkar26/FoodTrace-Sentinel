import pytest
from sqlalchemy import select

from app.models.batch import Batch
from app.models.batch_event import BatchEvent
from app.models.batch_genealogy import BatchGenealogy
from app.models.batch_trace_identity import BatchTraceIdentity


def _batch(client, references, code, *, quantity="100.000", unit="kg"):
    response = client.post(
        "/api/v1/batches",
        json={
            "batch_code": code,
            "product_id": references["product_id"],
            "origin_organization_id": references["organization_id"],
            "origin_location": "Recall test location",
            "quantity": quantity,
            "unit": unit,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _link(client, parent, child, kind="transformation", quantity=None, unit=None):
    payload = {
        "parent_batch_id": parent["id"],
        "child_batch_id": child["id"],
        "relationship_type": kind,
    }
    if quantity is not None:
        payload.update(source_quantity=quantity, source_unit=unit)
    response = client.post("/api/v1/genealogy", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _simulate(client, code, **options):
    return client.post(
        "/api/v1/recalls/simulate",
        json={"root_batch_code": code, **options},
    )


def test_unknown_root_batch_returns_404(client):
    response = _simulate(client, "NOT-RECORDED")

    assert response.status_code == 404
    assert response.json()["detail"] == "The selected root batch was not found"


def test_batch_without_recorded_genealogy_is_a_candidate_by_itself(client, references):
    batch = _batch(client, references, "RECALL-ISOLATED")

    response = _simulate(client, batch["batch_code"])
    result = response.json()

    assert response.status_code == 200
    assert result["root_batch"]["batch_code"] == "RECALL-ISOLATED"
    assert result["root_batch"]["product_name"] == "Mango"
    assert result["root_batch"]["origin_organization"] == "North Farm"
    assert result["related_batches"] == []
    assert result["upstream"] == []
    assert result["downstream"] == []
    assert result["relationships"] == []
    assert result["completeness"]["traversal_complete"] is True
    assert any("no recorded upstream" in warning for warning in result["warnings"])
    assert any("not been independently verified" in warning for warning in result["warnings"])
    assert "not an official recall" in result["human_review_warning"]


def test_traverses_upstream_downstream_split_merge_and_event_history(client, references):
    source = _batch(client, references, "RECALL-SOURCE")
    root = _batch(client, references, "RECALL-ROOT")
    child_a = _batch(client, references, "RECALL-CHILD-A", quantity="30.000")
    child_b = _batch(client, references, "RECALL-CHILD-B", quantity="20.000")
    merged = _batch(client, references, "RECALL-MERGED", quantity="45.000")
    _link(client, source, root, "transformation", "50.000", "kg")
    _link(client, root, child_a, "split", "30.000", "kg")
    _link(client, root, child_b, "split", "20.000", "kg")
    _link(client, child_a, merged, "merge")
    _link(client, child_b, merged, "merge")
    event_response = client.post(
        f"/api/v1/batches/{child_a['batch_code']}/events",
        json={
            "event_type": "dispatched",
            "occurred_at": "2026-10-04T09:00:00Z",
            "organization_id": references["organization_id"],
            "location": "Packing shed",
            "notes": "Carrier record ref 22",
        },
    )
    assert event_response.status_code == 201

    response = _simulate(client, root["batch_code"])
    result = response.json()

    assert response.status_code == 200, response.text
    assert [entry["batch_code"] for entry in result["upstream"]] == ["RECALL-SOURCE"]
    assert result["upstream"][0]["path"] == ["RECALL-ROOT", "RECALL-SOURCE"]
    assert {entry["batch_code"] for entry in result["downstream"]} == {
        "RECALL-CHILD-A", "RECALL-CHILD-B", "RECALL-MERGED",
    }
    paths = {entry["batch_code"]: entry["path"] for entry in result["downstream"]}
    assert paths["RECALL-CHILD-A"] == ["RECALL-ROOT", "RECALL-CHILD-A"]
    assert paths["RECALL-CHILD-B"] == ["RECALL-ROOT", "RECALL-CHILD-B"]
    assert paths["RECALL-MERGED"][0] == "RECALL-ROOT"
    assert paths["RECALL-MERGED"][-1] == "RECALL-MERGED"
    assert len(paths["RECALL-MERGED"]) == 3
    assert len(result["related_batches"]) == 4
    related_codes = {item["batch_code"] for item in result["related_batches"]}
    assert len(related_codes) == 4
    assert related_codes == {
        entry["batch_code"] for entry in [*result["upstream"], *result["downstream"]]
    }
    assert len(result["relationships"]) == 5
    assert {
        (item["parent_batch_code"], item["child_batch_code"], item["relationship_type"])
        for item in result["relationships"]
    } == {
        ("RECALL-SOURCE", "RECALL-ROOT", "transformation"),
        ("RECALL-ROOT", "RECALL-CHILD-A", "split"),
        ("RECALL-ROOT", "RECALL-CHILD-B", "split"),
        ("RECALL-CHILD-A", "RECALL-MERGED", "merge"),
        ("RECALL-CHILD-B", "RECALL-MERGED", "merge"),
    }
    split = next(item for item in result["relationships"] if item["child_batch_code"] == "RECALL-CHILD-A")
    assert split["relationship_type"] == "split"
    assert split["source_quantity"] == "30.000"
    assert split["source_unit"] == "kg"
    child_record = next(item for item in result["related_batches"] if item["batch_code"] == "RECALL-CHILD-A")
    assert child_record["events"][0]["event_type"] == "dispatched"
    assert child_record["events"][0]["organization_name"] == "North Farm"
    assert child_record["events"][0]["notes"] == "Carrier record ref 22"
    assert result["completeness"]["traversal_complete"] is True
    assert "affected_quantity" not in result


def test_duplicate_paths_return_one_batch_with_one_deterministic_path(client, references):
    root = _batch(client, references, "RECALL-DIAMOND-ROOT")
    left = _batch(client, references, "RECALL-DIAMOND-LEFT")
    right = _batch(client, references, "RECALL-DIAMOND-RIGHT")
    target = _batch(client, references, "RECALL-DIAMOND-TARGET")
    _link(client, root, left, "split")
    _link(client, root, right, "split")
    _link(client, left, target, "merge")
    _link(client, right, target, "merge")

    first = _simulate(client, root["batch_code"]).json()
    second = _simulate(client, root["batch_code"]).json()
    target_paths = [item for item in first["downstream"] if item["batch_code"] == target["batch_code"]]

    assert len(first["related_batches"]) == 3
    assert [item["batch_code"] for item in first["related_batches"]].count(target["batch_code"]) == 1
    assert len(target_paths) == 1
    assert target_paths[0]["path"] == [root["batch_code"], left["batch_code"], target["batch_code"]]
    assert first["downstream"] == second["downstream"]
    assert first["upstream"] == second["upstream"]
    assert first["related_batches"] == second["related_batches"]
    assert first["relationships"] == second["relationships"]
    assert first["trace_trust_findings"] == second["trace_trust_findings"]
    assert len(first["relationships"]) == 4
    assert {
        (item["parent_batch_code"], item["child_batch_code"])
        for item in first["relationships"]
        if item["child_batch_code"] == target["batch_code"]
    } == {
        (left["batch_code"], target["batch_code"]),
        (right["batch_code"], target["batch_code"]),
    }


def test_depth_limit_is_reported_and_boundary_relationship_is_shown(client, references):
    root = _batch(client, references, "RECALL-DEPTH-ROOT")
    child = _batch(client, references, "RECALL-DEPTH-CHILD")
    grandchild = _batch(client, references, "RECALL-DEPTH-GRANDCHILD")
    _link(client, root, child, "split")
    _link(client, child, grandchild, "split")

    response = _simulate(client, root["batch_code"], max_depth=1)
    result = response.json()

    assert response.status_code == 200
    assert [entry["batch_code"] for entry in result["downstream"]] == [child["batch_code"]]
    assert result["completeness"]["downstream_depth_limit_reached"] is True
    assert result["completeness"]["traversal_complete"] is False
    assert any(edge["child_batch_code"] == grandchild["batch_code"] for edge in result["relationships"])
    assert any("maximum depth of 1" in warning for warning in result["warnings"])


@pytest.mark.parametrize(
    ("max_depth", "expected_downstream", "limit_reached"),
    [
        (1, ["RECALL-CHAIN-C"], True),
        (3, ["RECALL-CHAIN-C", "RECALL-CHAIN-D"], False),
        (50, ["RECALL-CHAIN-C", "RECALL-CHAIN-D"], False),
    ],
)
def test_chain_traversal_obeys_minimum_normal_and_maximum_depth(
    client, references, max_depth, expected_downstream, limit_reached
):
    batch_a = _batch(client, references, "RECALL-CHAIN-A")
    batch_b = _batch(client, references, "RECALL-CHAIN-B")
    batch_c = _batch(client, references, "RECALL-CHAIN-C")
    batch_d = _batch(client, references, "RECALL-CHAIN-D")
    _link(client, batch_a, batch_b, "transformation")
    _link(client, batch_b, batch_c, "transformation")
    _link(client, batch_c, batch_d, "transformation")

    result = _simulate(client, batch_b["batch_code"], max_depth=max_depth).json()

    assert [entry["batch_code"] for entry in result["upstream"]] == ["RECALL-CHAIN-A"]
    assert result["upstream"][0]["path"] == ["RECALL-CHAIN-B", "RECALL-CHAIN-A"]
    assert [entry["batch_code"] for entry in result["downstream"]] == expected_downstream
    assert result["completeness"]["upstream_depth_limit_reached"] is False
    assert result["completeness"]["downstream_depth_limit_reached"] is limit_reached
    assert result["completeness"]["traversal_complete"] is (not limit_reached)
    if not limit_reached:
        assert result["downstream"][-1]["path"] == [
            "RECALL-CHAIN-B", "RECALL-CHAIN-C", "RECALL-CHAIN-D",
        ]


def test_cycle_in_malformed_legacy_graph_is_detected_without_infinite_traversal(
    client, references, db_session
):
    first = _batch(client, references, "RECALL-CYCLE-A")
    second = _batch(client, references, "RECALL-CYCLE-B")
    db_session.add_all(
        [
            BatchGenealogy(parent_batch_id=first["id"], child_batch_id=second["id"], relationship_type="split"),
            BatchGenealogy(parent_batch_id=second["id"], child_batch_id=first["id"], relationship_type="merge"),
        ]
    )
    db_session.commit()

    response = _simulate(client, first["batch_code"])
    result = response.json()

    assert response.status_code == 200
    assert result["completeness"]["cycle_detected"] is True
    assert result["completeness"]["traversal_complete"] is False
    assert any(item["check_type"] == "genealogy_cycle" for item in result["trace_trust_findings"])
    assert len(result["related_batches"]) == 1


def test_incompatible_units_and_missing_input_quantities_are_not_aggregated(client, references):
    parent = _batch(client, references, "RECALL-UNIT-PARENT", unit="kg")
    incompatible_child = _batch(client, references, "RECALL-UNIT-CHILD", unit="l")
    unmeasured_child = _batch(client, references, "RECALL-UNMEASURED-CHILD")
    _link(client, parent, incompatible_child, "transformation", "10.000", "kg")
    _link(client, parent, unmeasured_child, "split")

    response = _simulate(client, parent["batch_code"])
    result = response.json()

    assert response.status_code == 200
    assert {item["batch_code"] for item in result["related_batches"]} == {
        incompatible_child["batch_code"], unmeasured_child["batch_code"],
    }
    assert all("quantity" not in item for item in result["relationships"])
    assert {item["source_quantity"] for item in result["relationships"]} == {None, "10.000"}
    assert any(
        finding["check_type"] == "process_loss_incomplete"
        for finding in result["trace_trust_findings"]
    )
    candidate_codes = {
        parent["batch_code"], incompatible_child["batch_code"], unmeasured_child["batch_code"],
    }
    assert all(
        candidate_codes.intersection(finding["batch_codes"])
        for finding in result["trace_trust_findings"]
    )
    assert "affected_quantity" not in result
    assert any("No affected quantity is calculated or summed" in warning for warning in result["warnings"])
    assert "contaminated" not in result["human_review_warning"].lower()
    assert "fraud" not in result["human_review_warning"].lower()


def test_report_data_and_qr_trace_ids_are_unchanged_by_simulation(
    client, references, db_session
):
    parent = _batch(client, references, "RECALL-READONLY-PARENT")
    child = _batch(client, references, "RECALL-READONLY-CHILD")
    _link(client, parent, child, "split", "25.000", "kg")
    client.post(
        f"/api/v1/batches/{child['batch_code']}/events",
        json={"event_type": "stored", "occurred_at": "2026-10-04T12:00:00Z", "notes": "Keep existing record"},
    )

    def snapshot():
        return (
            [tuple(row) for row in db_session.execute(select(Batch.id, Batch.batch_code, Batch.quantity, Batch.unit, Batch.created_at).order_by(Batch.id))],
            [tuple(row) for row in db_session.execute(select(BatchEvent.id, BatchEvent.batch_id, BatchEvent.event_type, BatchEvent.occurred_at, BatchEvent.notes, BatchEvent.created_at).order_by(BatchEvent.id))],
            [tuple(row) for row in db_session.execute(select(BatchGenealogy.id, BatchGenealogy.parent_batch_id, BatchGenealogy.child_batch_id, BatchGenealogy.relationship_type, BatchGenealogy.source_quantity, BatchGenealogy.source_unit, BatchGenealogy.created_at).order_by(BatchGenealogy.id))],
            [tuple(row) for row in db_session.execute(select(BatchTraceIdentity.batch_id, BatchTraceIdentity.trace_id).order_by(BatchTraceIdentity.batch_id))],
        )

    before = snapshot()
    response = _simulate(client, parent["batch_code"])
    db_session.expire_all()
    after = snapshot()

    assert response.status_code == 200
    assert before == after


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"root_batch_code": "   "},
        {"root_batch_code": "R" * 65},
        {"root_batch_code": "ROOT", "max_depth": 0},
        {"root_batch_code": "ROOT", "max_depth": 51},
        {"root_batch_code": "ROOT", "max_depth": "invalid"},
        {"root_batch_code": "ROOT", "max_depth": 1.5},
    ],
)
def test_invalid_simulation_scope_is_rejected(client, payload):
    response = client.post("/api/v1/recalls/simulate", json=payload)

    assert response.status_code == 422
