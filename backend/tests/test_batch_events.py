from datetime import datetime, timezone

import pytest


def test_create_event_preserves_batch_and_normalizes_timestamp_to_utc(
    client, references
):
    batch = client.post("/api/v1/batches", json={
        "batch_code": "EVENT-100",
        "product_id": references["product_id"],
        "origin_organization_id": references["organization_id"],
        "origin_location": "North Farm",
        "quantity": "25.000",
        "unit": "kg",
    }).json()

    response = client.post(
        "/api/v1/batches/EVENT-100/events",
        json={
            "event_type": "quality_checked",
            "occurred_at": "2026-10-09T14:30:00+05:30",
            "organization_id": references["organization_id"],
            "location": "Packing station",
            "notes": "Grade A sample passed",
        },
    )

    assert response.status_code == 201
    event = response.json()
    assert event["batch_id"] == batch["id"]
    assert event["event_type"] == "quality_checked"
    assert event["occurred_at"] == "2026-10-09T09:00:00Z"
    assert event["organization"]["id"] == references["organization_id"]
    assert event["location"] == "Packing station"
    assert event["notes"] == "Grade A sample passed"
    assert event["created_at"].endswith("Z")


def test_event_timestamp_defaults_to_utc_and_list_is_chronological(
    client, references
):
    client.post("/api/v1/batches", json={
        "batch_code": "EVENT-200",
        "product_id": references["product_id"],
        "origin_organization_id": references["organization_id"],
        "origin_location": "North Farm",
        "quantity": "25.000",
        "unit": "kg",
    })
    latest = client.post(
        "/api/v1/batches/EVENT-200/events",
        json={"event_type": "delivered"},
    )
    earlier = client.post(
        "/api/v1/batches/EVENT-200/events",
        json={
            "event_type": "dispatched",
            "occurred_at": "2026-10-01T12:00:00Z",
        },
    )

    response = client.get("/api/v1/batches/EVENT-200/events")
    items = response.json()["items"]

    assert latest.status_code == earlier.status_code == 201
    assert datetime.fromisoformat(latest.json()["occurred_at"].replace("Z", "+00:00")).tzinfo == timezone.utc
    assert response.status_code == 200
    assert response.json()["total"] == 2
    assert [item["event_type"] for item in items] == ["dispatched", "delivered"]


@pytest.mark.parametrize(
    ("batch_code", "payload", "expected_status"),
    [
        ("MISSING-100", {"event_type": "received"}, 404),
        ("MNG-100", {"event_type": "received", "organization_id": 999}, 404),
        ("MNG-100", {"event_type": "unknown"}, 422),
        ("MNG-100", {"event_type": "stored", "location": "   "}, 422),
        ("MNG-100", {"event_type": "stored", "occurred_at": "not-a-date"}, 422),
    ],
)
def test_invalid_event_references_and_fields_are_rejected(
    client, references, batch_code, payload, expected_status
):
    client.post("/api/v1/batches", json={
        "batch_code": "MNG-100",
        "product_id": references["product_id"],
        "origin_organization_id": references["organization_id"],
        "origin_location": "North Farm",
        "quantity": "25.000",
        "unit": "kg",
    })

    response = client.post(f"/api/v1/batches/{batch_code}/events", json=payload)

    assert response.status_code == expected_status


def test_event_list_returns_not_found_for_missing_batch(client):
    response = client.get("/api/v1/batches/MISSING-100/events")

    assert response.status_code == 404
