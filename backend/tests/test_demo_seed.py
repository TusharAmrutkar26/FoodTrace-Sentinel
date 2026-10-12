from sqlalchemy import func, select

from app.models.batch import Batch
from app.models.batch_event import BatchEvent
from app.models.batch_genealogy import BatchGenealogy
from app.models.batch_trace_identity import BatchTraceIdentity
from app.models.organization import Organization
from app.models.product import Product
from app.scripts.seed_demo_data import seed_demo_data


def test_seed_is_idempotent_and_seeded_catalogs_feed_real_batch_api(client, db_session):
    first = seed_demo_data(db_session)
    second = seed_demo_data(db_session)

    assert (first.products_added, first.products_reused) == (6, 0)
    assert (first.organizations_added, first.organizations_reused) == (6, 0)
    assert (first.batches_added, first.batches_reused) == (8, 0)
    assert (first.genealogy_added, first.genealogy_reused, first.genealogy_skipped) == (2, 0, 0)
    assert (second.products_added, second.products_reused) == (0, 6)
    assert (second.organizations_added, second.organizations_reused) == (0, 6)
    assert (second.batches_added, second.batches_reused) == (0, 8)
    assert (second.genealogy_added, second.genealogy_reused, second.genealogy_skipped) == (0, 2, 0)

    product_page = client.get("/api/v1/products?limit=100&offset=0").json()
    organization_page = client.get("/api/v1/organizations?limit=100&offset=0").json()
    assert product_page["total"] == 6
    assert {row["name"] for row in product_page["items"]} == {
        "Mango", "Tomato", "Rice", "Wheat", "Milk", "Onion"
    }
    assert organization_page["total"] == 6
    assert {row["name"] for row in organization_page["items"]} == {
        "Mango Farm", "Green Valley Farms", "Sunrise Agro", "Shree Farms",
        "Fresh Dairy Co.", "Maharashtra Agro",
    }

    mango = next(row for row in product_page["items"] if row["name"] == "Mango")
    mango_farm = next(row for row in organization_page["items"] if row["name"] == "Mango Farm")
    batch = client.post(
        "/api/v1/batches",
        json={
            "batch_code": "API-SEED-001",
            "product_id": mango["id"],
            "origin_organization_id": mango_farm["id"],
            "origin_location": "Ratnagiri, Maharashtra",
            "quantity": "12.500",
            "unit": "kg",
        },
    )
    assert batch.status_code == 201
    assert batch.json()["product"]["id"] == mango["id"]
    assert batch.json()["origin_organization"]["id"] == mango_farm["id"]


def test_seed_reuses_matching_rows_and_preserves_existing_batch_event_link_and_trace(
    client, db_session, monkeypatch
):
    monkeypatch.setattr(
        "app.services.qr_codes.PUBLIC_TRACE_BASE_URL", "http://192.0.2.10:5176"
    )
    organization = client.post(
        "/api/v1/organizations",
        json={"name": "mango farm", "participant_type": "existing participant role"},
    ).json()
    product = client.post("/api/v1/products", json={"name": "mango"}).json()
    parent = client.post(
        "/api/v1/batches",
        json={
            "batch_code": "MNG-201",
            "product_id": product["id"],
            "origin_organization_id": organization["id"],
            "origin_location": "Existing recorded origin",
            "quantity": "100.000",
            "unit": "kg",
        },
    ).json()
    child = client.post(
        "/api/v1/batches",
        json={
            "batch_code": "MNG-202",
            "product_id": product["id"],
            "origin_organization_id": organization["id"],
            "origin_location": "Existing packing location",
            "quantity": "20.000",
            "unit": "kg",
        },
    ).json()
    event = client.post(
        "/api/v1/batches/MNG-201/events",
        json={"event_type": "quality_checked", "notes": "private existing note"},
    )
    relationship = client.post(
        "/api/v1/genealogy",
        json={
            "parent_batch_id": parent["id"],
            "child_batch_id": child["id"],
            "relationship_type": "split",
            "source_quantity": "10.000",
            "source_unit": "kg",
        },
    )
    trace_id = client.get("/api/v1/batches/MNG-201/qr").json()["trace_id"]
    assert event.status_code == 201
    assert relationship.status_code == 201

    result = seed_demo_data(db_session)

    assert result.products_added == 5
    assert result.products_reused == 1
    assert result.organizations_added == 5
    assert result.organizations_reused == 1
    assert result.batches_reused == 2
    assert result.genealogy_reused == 1
    assert result.genealogy_skipped == 1
    assert db_session.scalar(select(func.count(Product.id))) == 6
    assert db_session.scalar(select(func.count(Organization.id))) == 6
    assert db_session.scalar(
        select(Product.name).where(Product.id == product["id"])
    ) == "mango"
    assert db_session.scalar(
        select(Organization.participant_type).where(Organization.id == organization["id"])
    ) == "existing participant role"

    stored_parent = client.get("/api/v1/batches/MNG-201").json()
    stored_event = client.get("/api/v1/batches/MNG-201/events").json()["items"][0]
    stored_public_trace = client.get(f"/api/v1/public-traces/{trace_id}").json()
    assert stored_parent["origin_location"] == "Existing recorded origin"
    assert stored_event["notes"] == "private existing note"
    assert stored_public_trace["batch"]["batch_code"] == "MNG-201"
    assert "private existing note" not in str(stored_public_trace)
    assert db_session.scalar(select(func.count(Batch.id))) == 8
    assert db_session.scalar(select(func.count(BatchEvent.id))) == 1
    assert db_session.scalar(select(func.count(BatchGenealogy.id))) == 1
    assert db_session.scalar(select(func.count(BatchTraceIdentity.batch_id))) == 8
