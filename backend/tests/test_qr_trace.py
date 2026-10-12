from pathlib import Path
from xml.etree import ElementTree

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.pool import StaticPool

from app.db.session import build_engine
from tests.conftest import batch_payload

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _alembic_config(connection):
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option(
        "script_location", str(BACKEND_ROOT / "alembic").replace("%", "%%")
    )
    config.attributes["connection"] = connection
    return config


def test_qr_identity_is_stable_opaque_and_generates_svg(client, references, monkeypatch):
    monkeypatch.setattr(
        "app.services.qr_codes.PUBLIC_TRACE_BASE_URL", "http://192.0.2.10:5176"
    )
    created = client.post("/api/v1/batches", json=batch_payload(references))
    assert created.status_code == 201

    first = client.get("/api/v1/batches/MNG-100/qr")
    second = client.get("/api/v1/batches/mng-100/qr")

    assert first.status_code == second.status_code == 200
    identity = first.json()
    assert identity == second.json()
    assert len(identity["trace_id"]) == 32
    assert set(identity["trace_id"]) <= set("0123456789abcdef")
    assert identity["trace_url"] == (
        f"http://192.0.2.10:5176/trace/{identity['trace_id']}"
    )
    assert "MNG-100" not in identity["trace_url"]
    assert identity["trace_url"].endswith(f"/trace/{identity['trace_id']}")

    svg = client.get("/api/v1/batches/MNG-100/qr.svg")
    assert svg.status_code == 200
    assert svg.headers["content-type"].startswith("image/svg+xml")
    svg_root = ElementTree.fromstring(svg.content)
    assert svg_root.tag.endswith("svg")
    qr_paths = svg_root.findall(".//{http://www.w3.org/2000/svg}path")
    assert qr_paths
    assert qr_paths[0].attrib.get("d")


def test_qr_endpoints_report_missing_or_unreachable_frontend_configuration(
    client, references, monkeypatch
):
    client.post("/api/v1/batches", json=batch_payload(references))

    monkeypatch.setattr("app.services.qr_codes.PUBLIC_TRACE_BASE_URL", None)
    metadata = client.get("/api/v1/batches/MNG-100/qr")
    svg = client.get("/api/v1/batches/MNG-100/qr.svg")
    assert metadata.status_code == svg.status_code == 503
    assert "PUBLIC_TRACE_BASE_URL is not configured" in metadata.json()["detail"]

    monkeypatch.setattr(
        "app.services.qr_codes.PUBLIC_TRACE_BASE_URL", "http://127.0.0.1:5176"
    )
    loopback = client.get("/api/v1/batches/MNG-100/qr")
    assert loopback.status_code == 503
    assert "loopback" in loopback.json()["detail"]


def test_trace_url_configuration_rejects_invalid_origins(monkeypatch):
    from app.services.qr_codes import build_trace_url

    monkeypatch.setattr("app.services.qr_codes.PUBLIC_TRACE_BASE_URL", None)
    with pytest.raises(ValueError, match="PUBLIC_TRACE_BASE_URL is not configured"):
        build_trace_url("0123456789abcdef0123456789abcdef")

    for invalid in (
        "not a URL",
        "http://localhost:5176",
        "http://0.0.0.0:5176",
        "http://192.0.2.10:70000",
        "http://user:password@192.0.2.10:5176",
        "http://192.0.2.10:5176/trace",
    ):
        with pytest.raises(ValueError):
            build_trace_url("0123456789abcdef0123456789abcdef", invalid)


def test_public_trace_returns_available_data_without_internal_notes(
    client, references, monkeypatch
):
    monkeypatch.setattr(
        "app.services.qr_codes.PUBLIC_TRACE_BASE_URL", "http://192.0.2.10:5176"
    )
    parent = client.post(
        "/api/v1/batches", json=batch_payload(references, batch_code="MNG-SOURCE")
    )
    child = client.post(
        "/api/v1/batches", json=batch_payload(references, batch_code="MNG-CHILD")
    )
    assert parent.status_code == child.status_code == 201

    event = client.post(
        "/api/v1/batches/MNG-CHILD/events",
        json={
            "event_type": "quality_checked",
            "location": "Packing station",
            "notes": "INTERNAL NOTE: supplier phone number and private review",
        },
    )
    assert event.status_code == 201
    relation = client.post(
        "/api/v1/genealogy",
        json={
            "parent_batch_id": parent.json()["id"],
            "child_batch_id": child.json()["id"],
            "relationship_type": "transformation",
            "source_quantity": "10.00",
            "source_unit": "kg",
        },
    )
    assert relation.status_code == 201

    identity = client.get("/api/v1/batches/MNG-CHILD/qr").json()
    response = client.get(f"/api/v1/public-traces/{identity['trace_id']}")

    assert response.status_code == 200
    body = response.json()
    assert body["batch"]["batch_code"] == "MNG-CHILD"
    assert body["batch"]["product_name"] == "Mango"
    assert body["batch"]["origin_organization"] == "North Farm"
    assert body["events"] == [
        {
            "event_type": "quality_checked",
            "occurred_at": event.json()["occurred_at"],
            "location": "Packing station",
        }
    ]
    assert body["parents"][0]["parent"]["batch_code"] == "MNG-SOURCE"
    assert body["upstream"][0]["batch_code"] == "MNG-SOURCE"
    assert body["children"] == []
    assert body["downstream"] == []
    assert "notes" not in response.text
    assert "phone number" not in response.text
    assert '"id"' not in response.text
    assert "participant_type" not in response.text


def test_unknown_batch_qr_and_public_trace_return_not_found(client):
    unknown_qr = client.get("/api/v1/batches/DOES-NOT-EXIST/qr")
    unknown_svg = client.get("/api/v1/batches/DOES-NOT-EXIST/qr.svg")
    unknown_trace = client.get("/api/v1/public-traces/00000000000000000000000000000000")

    assert unknown_qr.status_code == 404
    assert unknown_svg.status_code == 404
    assert unknown_trace.status_code == 404


def test_migration_backfills_existing_batches_without_changing_them():
    engine = build_engine("sqlite://", poolclass=StaticPool)
    try:
        with engine.connect() as connection:
            config = _alembic_config(connection)
            command.upgrade(config, "20261010_0002")
            connection.execute(
                text("INSERT INTO organizations (name) VALUES ('Legacy Farm')")
            )
            connection.execute(text("INSERT INTO products (name) VALUES ('Pear')"))
            connection.execute(
                text(
                    "INSERT INTO batches "
                    "(batch_code, product_id, origin_organization_id, origin_location, quantity, unit) "
                    "VALUES ('LEGACY-001', 1, 1, 'Orchard', '3.500', 'kg')"
                )
            )
            connection.commit()

            command.upgrade(config, "head")

            batch = connection.execute(
                text("SELECT batch_code, quantity, unit FROM batches WHERE id = 1")
            ).one()
            identity = connection.execute(
                text("SELECT trace_id FROM batch_trace_identities WHERE batch_id = 1")
            ).scalar_one()

        assert tuple(batch) == ("LEGACY-001", "3.500", "kg")
        assert len(identity) == 32
    finally:
        engine.dispose()
