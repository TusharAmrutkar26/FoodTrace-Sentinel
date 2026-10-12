from datetime import date, datetime, timezone

import pytest
from sqlalchemy import func, select

from app.models.batch import Batch
from app.models.batch_event import BatchEvent
from app.models.batch_genealogy import BatchGenealogy
from app.models.batch_trace_identity import BatchTraceIdentity
from app.services.supply_chain_reports import default_report_period


def _make_batch(client, references, code: str, *, unit: str = "kg"):
    response = client.post(
        "/api/v1/batches",
        json={
            "batch_code": code,
            "product_id": references["product_id"],
            "origin_organization_id": references["organization_id"],
            "origin_location": "Report test farm",
            "quantity": "12.500",
            "unit": unit,
        },
    )
    assert response.status_code == 201
    return response.json()


def _counts(response):
    report = response.json()
    return (
        report["batches_created"],
        report["batches_with_event_activity"],
        {item["event_type"]: item["count"] for item in report["event_counts"]},
        {item["relationship_type"]: item["count"] for item in report["genealogy_counts"]},
    )


def test_default_period_is_the_last_seven_completed_utc_days():
    start, end = default_report_period(date(2026, 10, 11))

    assert start == date(2026, 10, 4)
    assert end == date(2026, 10, 10)
    assert (end - start).days == 6


def test_empty_database_returns_real_zero_counts_and_unavailable_metrics(client):
    response = client.get(
        "/api/v1/reports/supply-chain",
        params={"start_date": "2026-10-01", "end_date": "2026-10-07"},
    )

    assert response.status_code == 200
    report = response.json()
    assert report["has_activity"] is False
    assert report["batches_created"] == 0
    assert report["batches_with_event_activity"] == 0
    assert all(item["count"] == 0 for item in report["event_counts"])
    assert all(item["count"] == 0 for item in report["genealogy_counts"])
    assert report["quantity_metrics"]["available"] is False
    assert report["quantity_metrics"]["value"] is None
    assert "do not record quantities" in report["quantity_metrics"]["reason"]
    assert report["trace_trust_findings"]["available"] is False
    assert "no recorded finding timestamp" in report["trace_trust_findings"]["reason"]


def test_default_endpoint_returns_a_complete_utc_week(client):
    response = client.get("/api/v1/reports/supply-chain")
    period = response.json()["period"]
    start = date.fromisoformat(period["start_date"])
    end = date.fromisoformat(period["end_date"])

    assert response.status_code == 200
    assert period["timezone"] == "UTC"
    assert (end - start).days == 6


def test_report_includes_start_and_end_day_and_excludes_next_day(client, references, db_session):
    batch_in = _make_batch(client, references, "REPORT-IN")
    batch_out = _make_batch(client, references, "REPORT-OUT")
    db_session.execute(
        select(Batch).where(Batch.batch_code == "REPORT-IN")
    ).scalar_one().created_at = datetime(2026, 10, 1, 0, 0, tzinfo=timezone.utc)
    db_session.execute(
        select(Batch).where(Batch.batch_code == "REPORT-OUT")
    ).scalar_one().created_at = datetime(2026, 10, 8, 0, 0, tzinfo=timezone.utc)
    db_session.commit()

    for code, kind, occurred_at in [
        (batch_in["batch_code"], "received", "2026-10-01T00:00:00Z"),
        (batch_in["batch_code"], "dispatched", "2026-10-07T23:59:59Z"),
        (batch_out["batch_code"], "delivered", "2026-10-08T00:00:00Z"),
    ]:
        assert client.post(
            f"/api/v1/batches/{code}/events",
            json={"event_type": kind, "occurred_at": occurred_at},
        ).status_code == 201

    response = client.get(
        "/api/v1/reports/supply-chain",
        params={"start_date": "2026-10-01", "end_date": "2026-10-07"},
    )
    report = response.json()
    event_counts = {item["event_type"]: item["count"] for item in report["event_counts"]}

    assert response.status_code == 200
    assert report["batches_created"] == 1
    assert report["batches_with_event_activity"] == 1
    assert event_counts["received"] == 1
    assert event_counts["dispatched"] == 1
    assert event_counts["delivered"] == 0


def test_event_and_genealogy_counts_are_grouped_and_deterministic(client, references, db_session):
    parent = _make_batch(client, references, "REPORT-PARENT")
    child_a = _make_batch(client, references, "REPORT-CHILD-A")
    child_b = _make_batch(client, references, "REPORT-CHILD-B")
    for event_type in ("harvested", "received", "received"):
        assert client.post(
            f"/api/v1/batches/{parent['batch_code']}/events",
            json={"event_type": event_type, "occurred_at": "2026-10-05T12:00:00Z"},
        ).status_code == 201
    assert client.post(
        "/api/v1/genealogy",
        json={
            "parent_batch_id": parent["id"], "child_batch_id": child_a["id"],
            "relationship_type": "split", "source_quantity": "4.000", "source_unit": "kg",
        },
    ).status_code == 201
    assert client.post(
        "/api/v1/genealogy",
        json={
            "parent_batch_id": parent["id"], "child_batch_id": child_b["id"],
            "relationship_type": "split", "source_quantity": "3.000", "source_unit": "kg",
        },
    ).status_code == 201
    db_session.query(BatchGenealogy).update(
        {BatchGenealogy.created_at: datetime(2026, 10, 5, 12, tzinfo=timezone.utc)}
    )
    db_session.commit()

    params = {"start_date": "2026-10-05", "end_date": "2026-10-05"}
    first = client.get("/api/v1/reports/supply-chain", params=params)
    second = client.get("/api/v1/reports/supply-chain", params=params)

    assert first.status_code == second.status_code == 200
    assert _counts(first) == _counts(second)
    assert first.json()["batches_with_event_activity"] == 1
    assert {item["event_type"]: item["count"] for item in first.json()["event_counts"]}["received"] == 2
    assert {item["relationship_type"]: item["count"] for item in first.json()["genealogy_counts"]}["split"] == 2


@pytest.mark.parametrize("child_unit", ["kg", "l"])
def test_quantity_metrics_remain_unavailable_for_same_or_mixed_units(client, references, child_unit):
    parent = _make_batch(client, references, "REPORT-QTY-PARENT", unit="kg")
    child = _make_batch(client, references, "REPORT-QTY-CHILD", unit=child_unit)
    response = client.post(
        "/api/v1/genealogy",
        json={
            "parent_batch_id": parent["id"], "child_batch_id": child["id"],
            "relationship_type": "transformation", "source_quantity": "2.000", "source_unit": "kg",
        },
    )
    assert response.status_code == 201

    report_response = client.get(
        "/api/v1/reports/supply-chain",
        params={"start_date": "2026-10-01", "end_date": "2026-10-07"},
    )

    metric = report_response.json()["quantity_metrics"]
    assert metric["available"] is False
    assert metric["value"] is None
    assert metric["unit"] is None
    assert "double-counting" in metric["reason"]


def test_transfer_events_do_not_create_production_quantity_or_batch_counts(client, references, db_session):
    batch = _make_batch(client, references, "REPORT-MOVEMENT")
    db_session.scalar(select(Batch).where(Batch.batch_code == batch["batch_code"])).created_at = datetime(
        2026, 9, 30, 12, tzinfo=timezone.utc
    )
    db_session.commit()
    for kind in ("dispatched", "delivered"):
        assert client.post(
            f"/api/v1/batches/{batch['batch_code']}/events",
            json={"event_type": kind, "occurred_at": "2026-10-03T12:00:00Z"},
        ).status_code == 201

    report = client.get(
        "/api/v1/reports/supply-chain",
        params={"start_date": "2026-10-01", "end_date": "2026-10-07"},
    ).json()

    assert report["batches_created"] == 0
    assert report["quantity_metrics"]["available"] is False
    assert "weekly production" in report["quantity_metrics"]["reason"]


def test_missing_event_quantity_is_not_inferred_from_notes_or_returned_as_zero(client, references):
    batch = _make_batch(client, references, "REPORT-NO-EVENT-QUANTITY")
    assert client.post(
        f"/api/v1/batches/{batch['batch_code']}/events",
        json={
            "event_type": "quality_checked",
            "occurred_at": "2026-10-03T12:00:00Z",
            "notes": "Sample notes mention 25 kg, but this is not a structured quantity.",
        },
    ).status_code == 201

    report = client.get(
        "/api/v1/reports/supply-chain",
        params={"start_date": "2026-10-01", "end_date": "2026-10-07"},
    ).json()

    assert report["event_counts"][[row["event_type"] for row in report["event_counts"]].index("quality_checked")]["count"] == 1
    assert report["quantity_metrics"]["available"] is False
    assert report["quantity_metrics"]["value"] is None


def test_report_request_does_not_modify_existing_records(client, references, db_session):
    batch = _make_batch(client, references, "REPORT-READONLY")
    child = _make_batch(client, references, "REPORT-READONLY-CHILD")
    client.post(
        f"/api/v1/batches/{batch['batch_code']}/events",
        json={"event_type": "stored", "occurred_at": "2026-10-03T12:00:00Z", "notes": "existing note"},
    )
    assert client.post(
        "/api/v1/genealogy",
        json={
            "parent_batch_id": batch["id"], "child_batch_id": child["id"],
            "relationship_type": "split", "source_quantity": "2.000", "source_unit": "kg",
        },
    ).status_code == 201

    def snapshot():
        return (
            [tuple(row) for row in db_session.execute(select(Batch.id, Batch.batch_code, Batch.quantity, Batch.unit, Batch.created_at).order_by(Batch.id))],
            [tuple(row) for row in db_session.execute(select(BatchEvent.id, BatchEvent.batch_id, BatchEvent.event_type, BatchEvent.occurred_at, BatchEvent.notes, BatchEvent.created_at).order_by(BatchEvent.id))],
            [tuple(row) for row in db_session.execute(select(BatchGenealogy.id, BatchGenealogy.parent_batch_id, BatchGenealogy.child_batch_id, BatchGenealogy.relationship_type, BatchGenealogy.source_quantity, BatchGenealogy.source_unit, BatchGenealogy.created_at).order_by(BatchGenealogy.id))],
            [tuple(row) for row in db_session.execute(select(BatchTraceIdentity.batch_id, BatchTraceIdentity.trace_id).order_by(BatchTraceIdentity.batch_id))],
        )

    before = snapshot()
    counts_before = (
        db_session.scalar(select(func.count(Batch.id))),
        db_session.scalar(select(func.count(BatchEvent.id))),
        db_session.scalar(select(func.count(BatchGenealogy.id))),
    )

    response = client.get(
        "/api/v1/reports/supply-chain",
        params={"start_date": "2026-10-01", "end_date": "2026-10-07"},
    )

    db_session.expire_all()
    after = snapshot()
    counts_after = (
        db_session.scalar(select(func.count(Batch.id))),
        db_session.scalar(select(func.count(BatchEvent.id))),
        db_session.scalar(select(func.count(BatchGenealogy.id))),
    )
    assert response.status_code == 200
    assert before == after
    assert counts_before == counts_after


@pytest.mark.parametrize(
    "params",
    [
        {"start_date": "2026-10-08", "end_date": "2026-10-07"},
        {"start_date": "2026-10-01"},
        {"end_date": "2026-10-07"},
        {"start_date": "not-a-date", "end_date": "2026-10-07"},
    ],
)
def test_invalid_report_ranges_are_rejected(client, params):
    assert client.get("/api/v1/reports/supply-chain", params=params).status_code == 422
