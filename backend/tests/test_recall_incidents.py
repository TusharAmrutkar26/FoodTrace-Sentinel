from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.pool import StaticPool

from app.db.session import build_engine


def _batch(client, references, code="INCIDENT-ROOT"):
    response = client.post(
        "/api/v1/batches",
        json={
            "batch_code": code,
            "product_id": references["product_id"],
            "origin_organization_id": references["organization_id"],
            "origin_location": "Incident test location",
            "quantity": "100.000",
            "unit": "kg",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_incident(client, batch_code="INCIDENT-ROOT", **payload):
    return client.post(
        "/api/v1/recall-incidents",
        json={"root_batch_code": batch_code, "reason": "Review a reported concern", **payload},
    )


def test_create_list_and_retrieve_incident_with_stable_reference(client, references):
    batch = _batch(client, references)
    created = _create_incident(client, batch["batch_code"], created_by="Operator entered")

    assert created.status_code == 201, created.text
    incident = created.json()
    assert incident["reference_id"].startswith("RC-")
    assert incident["root_batch_code"] == batch["batch_code"]
    assert incident["status"] == "pending_review"
    assert incident["created_by"] == "platform-admin@example.test"
    assert incident["created_by_verified"] is True
    assert incident["snapshots"] == []
    assert incident["reviews"] == []
    assert incident["actions"] == []

    listed = client.get("/api/v1/recall-incidents?limit=10&offset=0")
    detail = client.get(f"/api/v1/recall-incidents/{incident['reference_id']}")
    pending = client.get("/api/v1/recall-incidents?status=pending_review")
    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    assert listed.json()["items"][0]["reference_id"] == incident["reference_id"]
    assert pending.json()["total"] == 1
    assert detail.status_code == 200
    assert detail.json()["reference_id"] == incident["reference_id"]
    assert client.get("/api/v1/recall-incidents/unknown").status_code == 404


def test_invalid_batch_and_incident_fields_are_rejected(client, references):
    assert _create_incident(client, "UNKNOWN-BATCH").status_code == 404
    assert client.post(
        "/api/v1/recall-incidents",
        json={"root_batch_code": "", "reason": "Reason"},
    ).status_code == 422
    assert client.post(
        "/api/v1/recall-incidents",
        json={"root_batch_code": "ROOT", "reason": "   "},
    ).status_code == 422
    _batch(client, references)


def test_snapshot_uses_existing_simulator_and_persists_candidate_evidence(client, references):
    root = _batch(client, references)
    child = _batch(client, references, "INCIDENT-CHILD")
    link = client.post(
        "/api/v1/genealogy",
        json={
            "parent_batch_id": root["id"],
            "child_batch_id": child["id"],
            "relationship_type": "split",
            "source_quantity": "25.000",
            "source_unit": "kg",
        },
    )
    assert link.status_code == 201
    incident = _create_incident(client).json()

    snapshot_response = client.post(
        f"/api/v1/recall-incidents/{incident['reference_id']}/snapshots",
        json={"max_depth": 7},
    )
    assert snapshot_response.status_code == 201, snapshot_response.text
    snapshot = snapshot_response.json()
    assert snapshot["max_depth"] == 7
    assert snapshot["simulation"]["root_batch"]["batch_code"] == root["batch_code"]
    assert [item["batch_code"] for item in snapshot["simulation"]["downstream"]] == [child["batch_code"]]
    assert snapshot["simulation"]["relationships"][0]["relationship_type"] == "split"

    fetched = client.get(f"/api/v1/recall-incidents/{incident['reference_id']}").json()
    assert len(fetched["snapshots"]) == 1
    assert fetched["snapshots"][0]["simulation"] == snapshot["simulation"]
    assert any(item["event_type"] == "candidate_scope_captured" for item in fetched["history"])
    assert client.post(
        f"/api/v1/recall-incidents/{incident['reference_id']}/snapshots",
        json={"max_depth": 51},
    ).status_code == 422
    assert client.post("/api/v1/recall-incidents/missing/snapshots", json={}).status_code == 404


def test_review_decisions_are_recorded_and_status_is_not_automatic(client, references):
    _batch(client, references)
    incident = _create_incident(client).json()
    assert incident["status"] == "pending_review"

    for decision in ("requires_investigation", "approved_for_next_step", "rejected"):
        response = client.post(
            f"/api/v1/recall-incidents/{incident['reference_id']}/reviews",
            json={"decision": decision, "notes": f"Notes for {decision}", "reviewer_name": "Entered reviewer"},
        )
        assert response.status_code == 201, response.text
        detail = response.json()
        assert detail["status"] == decision
        assert detail["reviews"][-1]["decision"] == decision
        assert detail["reviews"][-1]["reviewer_name"] == "platform-admin@example.test"
        assert detail["reviews"][-1]["reviewer_identity_verified"] is True
        assert detail["reviews"][-1]["notes"] == f"Notes for {decision}"

    assert len(detail["reviews"]) == 3
    assert client.get(f"/api/v1/recall-incidents/{incident['reference_id']}/history").json()
    assert client.post(
        f"/api/v1/recall-incidents/{incident['reference_id']}/reviews",
        json={"decision": "pending_review"},
    ).status_code == 422
    assert client.post("/api/v1/recall-incidents/missing/reviews", json={"decision": "rejected"}).status_code == 404


def test_follow_up_action_create_update_completion_and_validation(client, references):
    _batch(client, references)
    incident = _create_incident(client).json()
    create_response = client.post(
        f"/api/v1/recall-incidents/{incident['reference_id']}/actions",
        json={
            "description": "Check the recorded shipment paperwork",
            "assignee": "Entered assignee",
            "due_at": "2026-10-12T11:00:00+05:30",
            "evidence_references": ["DOC-19", "https://example.invalid/record"],
        },
    )
    assert create_response.status_code == 201, create_response.text
    action = create_response.json()["actions"][0]
    assert action["status"] == "open"
    assert action["assignee"] == "Entered assignee"
    assert action["due_at"].endswith("Z") or action["due_at"].endswith("+00:00")
    assert action["evidence_references"] == ["DOC-19", "https://example.invalid/record"]

    updated = client.patch(
        f"/api/v1/recall-incidents/{incident['reference_id']}/actions/{action['id']}",
        json={"status": "completed", "completion_notes": "Documents reviewed"},
    )
    assert updated.status_code == 200, updated.text
    saved = updated.json()["actions"][0]
    assert saved["status"] == "completed"
    assert saved["completion_notes"] == "Documents reviewed"
    assert saved["completed_at"] is not None
    assert any(item["event_type"] == "follow_up_action_updated" for item in updated.json()["history"])

    assert client.post(
        f"/api/v1/recall-incidents/{incident['reference_id']}/actions",
        json={"description": " "},
    ).status_code == 422
    assert client.patch(
        f"/api/v1/recall-incidents/{incident['reference_id']}/actions/999",
        json={"status": "completed"},
    ).status_code == 404
    assert client.patch(
        f"/api/v1/recall-incidents/{incident['reference_id']}/actions/{action['id']}",
        json={},
    ).status_code == 422
    assert client.patch(
        "/api/v1/recall-incidents/missing/actions/1", json={"status": "open"}
    ).status_code == 404


def test_new_migration_preserves_existing_rows_on_isolated_sqlite_database():
    backend_root = Path(__file__).resolve().parents[1]
    engine = build_engine("sqlite://", poolclass=StaticPool)
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic").replace("%", "%%"))
    try:
        with engine.connect() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "20261010_0003")
            connection.execute(text("INSERT INTO organizations (id, name, participant_type) VALUES (1, 'Migration Farm', 'farm')"))
            connection.execute(text("INSERT INTO products (id, name) VALUES (1, 'Migration Mango')"))
            connection.execute(text(
                "INSERT INTO batches (id, batch_code, product_id, origin_organization_id, origin_location, quantity, unit) "
                "VALUES (1, 'MIGRATION-KEEP', 1, 1, 'Field 4', '12.500', 'kg')"
            ))
            command.upgrade(config, "head")
            row = connection.execute(
                text("SELECT batch_code, quantity, unit FROM batches WHERE id = 1")
            ).one()
            revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            tables = set(connection.execute(text(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )).scalars())
            assert tuple(row) == ("MIGRATION-KEEP", "12.500", "kg")
            assert revision == "20261011_0005"
            assert {
                "recall_incidents", "recall_candidate_snapshots", "recall_reviews",
                "recall_follow_up_actions", "recall_incident_history", "users",
            }.issubset(tables)
            with pytest.raises(NotImplementedError, match="forward-only"):
                command.downgrade(config, "20261010_0003")
            assert connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one() == "20261011_0005"
            assert connection.execute(
                text("SELECT batch_code, quantity, unit FROM batches WHERE id = 1")
            ).one() == row
    finally:
        engine.dispose()
