from decimal import Decimal

from sqlalchemy import select, text

from app.api.v1 import trust as trust_routes
from app.models.batch import Batch
from app.models.batch_event import BatchEvent
from app.models.batch_genealogy import BatchGenealogy
from app.services.trace_trust import get_trust_findings


def create_batch(client, references, batch_code, quantity="100.000", unit="kg"):
    response = client.post(
        "/api/v1/batches",
        json={
            "batch_code": batch_code,
            "product_id": references["product_id"],
            "origin_organization_id": references["organization_id"],
            "origin_location": "North Farm",
            "quantity": quantity,
            "unit": unit,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def add_edge(db_session, parent_id, child_id, relationship_type="split", quantity=None, unit=None):
    db_session.execute(
        text(
            "INSERT INTO batch_genealogy "
            "(parent_batch_id, child_batch_id, relationship_type, source_quantity, source_unit) "
            "VALUES (:parent_id, :child_id, :relationship_type, :quantity, :unit)"
        ),
        {
            "parent_id": parent_id,
            "child_id": child_id,
            "relationship_type": relationship_type,
            "quantity": quantity,
            "unit": unit,
        },
    )
    db_session.commit()


def check_findings(client, monkeypatch, **query):
    monkeypatch.setattr(trust_routes, "TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT", Decimal("20"))
    response = client.get("/api/v1/trust/findings", params=query)
    assert response.status_code == 200, response.text
    return response.json()


def test_empty_database_returns_zero_counts_and_valid_page(client):
    response = client.get("/api/v1/trust/findings")

    assert response.status_code == 200
    assert response.json() == {
        "items": [],
        "total": 0,
        "limit": 50,
        "offset": 0,
        "counts": {"high": 0, "medium": 0, "low": 0, "incomplete": 0},
    }


def test_valid_batch_without_required_events_or_genealogy_is_not_flagged(client, references):
    create_batch(client, references, "NORMAL-1")

    result = client.get("/api/v1/trust/findings").json()

    assert result["items"] == []
    assert result["total"] == 0


def test_valid_split_allocations_and_zero_loss_are_not_flagged(client, references):
    parent = create_batch(client, references, "VALID-SPLIT-PARENT", quantity="100.000")
    for code, quantity in (("VALID-SPLIT-A", "60.000"), ("VALID-SPLIT-B", "40.000")):
        child = create_batch(client, references, code, quantity=quantity)
        response = client.post(
            "/api/v1/genealogy",
            json={
                "parent_batch_id": parent["id"],
                "child_batch_id": child["id"],
                "relationship_type": "split",
                "source_quantity": quantity,
                "source_unit": "kg",
            },
        )
        assert response.status_code == 201, response.text

    result = client.get("/api/v1/trust/findings").json()

    assert result["total"] == 0


def test_invalid_stored_quantity_and_unit_are_explained(client, db_session, references, monkeypatch):
    batch = create_batch(client, references, "DAMAGED-1")
    db_session.execute(
        text("UPDATE batches SET quantity = '-2.5', unit = 'stone' WHERE id = :id"),
        {"id": batch["id"]},
    )
    db_session.commit()

    result = check_findings(client, monkeypatch, batch_code="damaged-1")

    by_type = {item["check_type"]: item for item in result["items"]}
    assert set(by_type) == {"batch_quantity_invalid", "batch_unit_invalid"}
    assert all(item["severity"] == "high" for item in by_type.values())
    assert all(item["batch_codes"] == ["DAMAGED-1"] for item in by_type.values())
    assert all(item["recommended_action"] for item in by_type.values())


def test_malformed_stored_decimal_is_reported_without_parsing_unbounded_exponents(
    client, db_session, references, monkeypatch
):
    batch = create_batch(client, references, "MALFORMED-DECIMAL")
    db_session.execute(
        text("UPDATE batches SET quantity = '1e999999999' WHERE id = :id"),
        {"id": batch["id"]},
    )
    db_session.commit()

    result = check_findings(client, monkeypatch, batch_code="MALFORMED-DECIMAL")

    assert result["total"] == 1
    assert result["items"][0]["check_type"] == "batch_quantity_invalid"


def test_invalid_source_quantity_and_unit_mismatch_are_reported_without_conversion(
    client, db_session, references, monkeypatch
):
    parent = create_batch(client, references, "SOURCE-1", quantity="100.000")
    child = create_batch(client, references, "CHILD-1", quantity="50.000")
    add_edge(db_session, parent["id"], child["id"], quantity="-1.0", unit="kg")
    second_child = create_batch(client, references, "CHILD-2", quantity="50.000")
    add_edge(db_session, parent["id"], second_child["id"], quantity="25.0", unit="l")
    third_child = create_batch(client, references, "CHILD-3", quantity="50.000")
    add_edge(db_session, parent["id"], third_child["id"], quantity="10.0", unit="stone")

    findings = check_findings(client, monkeypatch)["items"]
    check_types = {item["check_type"] for item in findings}
    assert "genealogy_source_quantity_invalid" in check_types
    assert "genealogy_source_unit_mismatch" in check_types
    assert "genealogy_source_unit_invalid" in check_types
    mismatch = next(item for item in findings if item["check_type"] == "genealogy_source_unit_mismatch")
    assert "did not convert" in mismatch["explanation"]


def test_split_overallocation_uses_exact_same_unit_quantities(
    client, db_session, references, monkeypatch
):
    parent = create_batch(client, references, "SPLIT-PARENT", quantity="100.000")
    first = create_batch(client, references, "SPLIT-A", quantity="60.000")
    second = create_batch(client, references, "SPLIT-B", quantity="50.000")
    add_edge(db_session, parent["id"], first["id"], quantity="60.000", unit="kg")
    add_edge(db_session, parent["id"], second["id"], quantity="40.001", unit="kg")

    result = check_findings(client, monkeypatch, check_type="split_overallocated")

    assert result["total"] == 1
    evidence = {item["label"]: item["value"] for item in result["items"][0]["evidence"]}
    assert evidence["Recorded allocation total"] == "100.001 kg"
    assert result["items"][0]["severity"] == "high"


def test_source_quantity_over_parent_is_high_and_not_reused_as_process_loss(
    client, db_session, references, monkeypatch
):
    parent = create_batch(client, references, "OVER-PARENT", quantity="10.000")
    child = create_batch(client, references, "OVER-CHILD", quantity="5.000")
    add_edge(db_session, parent["id"], child["id"], "transformation", "12.000", "kg")

    result = check_findings(client, monkeypatch)

    assert [item["check_type"] for item in result["items"]] == ["genealogy_source_quantity_invalid"]
    assert result["items"][0]["severity"] == "high"


def test_high_process_loss_uses_configurable_threshold_and_same_unit_only(
    client, references, monkeypatch
):
    parent = create_batch(client, references, "LOSS-IN", quantity="100.000")
    child = create_batch(client, references, "LOSS-OUT", quantity="70.000")
    response = client.post(
        "/api/v1/genealogy",
        json={
            "parent_batch_id": parent["id"],
            "child_batch_id": child["id"],
            "relationship_type": "transformation",
            "source_quantity": "100.000",
            "source_unit": "kg",
        },
    )
    assert response.status_code == 201, response.text
    monkeypatch.setattr(trust_routes, "TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT", Decimal("20"))

    result = client.get("/api/v1/trust/findings", params={"check_type": "process_loss"}).json()

    assert result["total"] == 1
    finding = result["items"][0]
    assert finding["severity"] == "medium"
    assert finding["status"] == "detected"
    assert "30.00%" in finding["explanation"]
    assert {entry["label"]: entry["value"] for entry in finding["evidence"]}["Recorded output"] == "70.000 kg"
    monkeypatch.setattr(trust_routes, "TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT", Decimal("30"))
    at_threshold = client.get("/api/v1/trust/findings", params={"check_type": "process_loss"}).json()
    assert at_threshold["total"] == 0


def test_process_loss_threshold_comparison_preserves_high_precision(client, references, monkeypatch):
    input_quantity = "100000000000000000000000000000.000000000000000000000000000000"
    output_quantity = "79999999999999999999999999999.999999999999999999999999999999"
    parent = create_batch(client, references, "PRECISE-IN", quantity=input_quantity)
    child = create_batch(client, references, "PRECISE-OUT", quantity=output_quantity)
    response = client.post(
        "/api/v1/genealogy",
        json={
            "parent_batch_id": parent["id"],
            "child_batch_id": child["id"],
            "relationship_type": "transformation",
            "source_quantity": input_quantity,
            "source_unit": "kg",
        },
    )
    assert response.status_code == 201, response.text
    monkeypatch.setattr(trust_routes, "TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT", Decimal("20"))

    result = client.get("/api/v1/trust/findings", params={"check_type": "process_loss"}).json()

    assert result["total"] == 1
    assert result["items"][0]["batch_codes"] == ["PRECISE-IN", "PRECISE-OUT"]


def test_incompatible_units_and_multi_parent_merge_are_incomplete_not_loss_findings(
    client, references, monkeypatch
):
    parent_kg = create_batch(client, references, "KG-IN", quantity="100.000", unit="kg")
    child_g = create_batch(client, references, "G-OUT", quantity="5.000", unit="g")
    parent_each = create_batch(client, references, "EACH-IN", quantity="18.000", unit="each")
    unit_edge = client.post(
        "/api/v1/genealogy",
        json={
            "parent_batch_id": parent_kg["id"],
            "child_batch_id": child_g["id"],
            "relationship_type": "transformation",
            "source_quantity": "50.000",
            "source_unit": "kg",
        },
    )
    assert unit_edge.status_code == 201, unit_edge.text
    merged = create_batch(client, references, "MERGED", quantity="20.000", unit="kg")
    for parent in (parent_kg, parent_each):
        response = client.post(
            "/api/v1/genealogy",
            json={
                "parent_batch_id": parent["id"],
                "child_batch_id": merged["id"],
                "relationship_type": "merge",
                "source_quantity": "10.000",
                "source_unit": parent["unit"],
            },
        )
        assert response.status_code == 201, response.text
    monkeypatch.setattr(trust_routes, "TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT", Decimal("20"))

    result = client.get("/api/v1/trust/findings").json()
    incomplete = [item for item in result["items"] if item["check_type"] == "process_loss_incomplete"]

    assert len(incomplete) == 2
    assert all(item["severity"] == "low" and item["status"] == "incomplete" for item in incomplete)
    assert not [item for item in result["items"] if item["check_type"] == "process_loss"]
    merge_result = next(item for item in incomplete if "MERGED" in item["batch_codes"])
    assert "not combined" in merge_result["explanation"]


def test_missing_input_quantity_is_reported_as_incomplete(client, db_session, references, monkeypatch):
    parent = create_batch(client, references, "MISSING-IN", quantity="10.000")
    child = create_batch(client, references, "MISSING-OUT", quantity="8.000")
    add_edge(db_session, parent["id"], child["id"], "split")

    result = check_findings(client, monkeypatch, status="incomplete")

    assert result["total"] == 1
    assert result["items"][0]["status"] == "incomplete"
    assert "does not record an input quantity" in result["items"][0]["explanation"]


def test_genealogy_cycle_is_detected_and_deterministic(client, db_session, references, monkeypatch):
    first = create_batch(client, references, "CYCLE-A")
    second = create_batch(client, references, "CYCLE-B")
    add_edge(db_session, first["id"], second["id"], "transformation")
    add_edge(db_session, second["id"], first["id"], "transformation")

    first_scan = check_findings(client, monkeypatch, check_type="genealogy_cycle")
    second_scan = check_findings(client, monkeypatch, check_type="genealogy_cycle")

    assert first_scan == second_scan
    assert first_scan["total"] == 1
    assert first_scan["items"][0]["batch_codes"] == ["CYCLE-A", "CYCLE-B"]
    assert first_scan["items"][0]["finding_id"].startswith("tt-")


def test_findings_filters_pagination_and_repeated_scan_are_stable(
    client, references, monkeypatch
):
    parent = create_batch(client, references, "FILTER-IN", quantity="100.000")
    child = create_batch(client, references, "FILTER-OUT", quantity="70.000")
    created = client.post(
        "/api/v1/genealogy",
        json={
            "parent_batch_id": parent["id"],
            "child_batch_id": child["id"],
            "relationship_type": "split",
            "source_quantity": "100.000",
            "source_unit": "kg",
        },
    )
    assert created.status_code == 201, created.text

    first = check_findings(client, monkeypatch, batch_code="filter-out", severity="medium")
    second = check_findings(client, monkeypatch, batch_code="FILTER-OUT", severity="medium")
    assert first == second
    assert first["total"] == 1
    assert first["items"][0]["check_type"] == "process_loss"
    assert check_findings(client, monkeypatch, batch_code="FILTER-OUT", limit=1, offset=1)["items"] == []


def test_trust_scan_does_not_change_existing_records(client, db_session, references, monkeypatch):
    batch = create_batch(client, references, "READ-ONLY")
    before = (
        db_session.execute(select(Batch.batch_code, Batch.quantity, Batch.unit)).all(),
        db_session.execute(select(BatchEvent.batch_id, BatchEvent.event_type, BatchEvent.occurred_at)).all(),
        db_session.execute(select(BatchGenealogy.parent_batch_id, BatchGenealogy.child_batch_id, BatchGenealogy.source_quantity, BatchGenealogy.source_unit)).all(),
    )

    check_findings(client, monkeypatch)
    db_session.expire_all()
    after = (
        db_session.execute(select(Batch.batch_code, Batch.quantity, Batch.unit)).all(),
        db_session.execute(select(BatchEvent.batch_id, BatchEvent.event_type, BatchEvent.occurred_at)).all(),
        db_session.execute(select(BatchGenealogy.parent_batch_id, BatchGenealogy.child_batch_id, BatchGenealogy.source_quantity, BatchGenealogy.source_unit)).all(),
    )

    assert batch["batch_code"] == "READ-ONLY"
    assert after == before


def test_query_validation_rejects_unsupported_filters(client):
    assert client.get("/api/v1/trust/findings", params={"severity": "critical"}).status_code == 422
    assert client.get("/api/v1/trust/findings", params={"limit": 101}).status_code == 422
    assert client.get("/api/v1/trust/findings", params={"offset": 10001}).status_code == 422


def test_service_threshold_is_decimal_and_findings_include_action(db_session, references, client):
    create_batch(client, references, "NO-ISSUE")
    result = get_trust_findings(db_session, process_loss_threshold_percent=Decimal("20"))

    assert result.total == 0
    assert result.counts.high == result.counts.medium == result.counts.low == 0
