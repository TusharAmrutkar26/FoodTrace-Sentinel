import pytest

from tests.conftest import batch_payload


def test_existing_health_endpoint_is_preserved(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_create_organization_endpoint(client):
    response = client.post(
        "/api/v1/organizations",
        json={"name": "Mango Farm", "participant_type": "supplier"},
    )

    assert response.status_code == 201
    assert response.json()["name"] == "Mango Farm"
    assert response.json()["participant_type"] == "supplier"
    assert response.json()["id"] > 0


def test_create_product_endpoint(client):
    response = client.post("/api/v1/products", json={"name": "Mango"})

    assert response.status_code == 201
    assert response.json()["name"] == "Mango"
    assert response.json()["id"] > 0


def test_create_batch_preserves_exact_quantity_and_references(client, references):
    response = client.post("/api/v1/batches", json=batch_payload(references))

    assert response.status_code == 201
    body = response.json()
    assert body["batch_code"] == "MNG-100"
    assert body["quantity"] == "100.000"
    assert body["unit"] == "kg"
    assert body["product"]["name"] == "Mango"
    assert body["origin_organization"]["name"] == "North Farm"
    assert body["created_at"].endswith("Z")


def test_batch_codes_are_unique_case_insensitively(client, references):
    first = client.post("/api/v1/batches", json=batch_payload(references))
    duplicate = client.post(
        "/api/v1/batches",
        json=batch_payload(references, batch_code="mng-100"),
    )

    assert first.status_code == 201
    assert duplicate.status_code == 409


@pytest.mark.parametrize("quantity", ["0", "-1", "NaN", "Infinity", "1e2", "not-a-number", 1.2])
def test_invalid_quantities_are_rejected(client, references, quantity):
    response = client.post(
        "/api/v1/batches",
        json=batch_payload(references, quantity=quantity),
    )

    assert response.status_code == 422


def test_invalid_unit_and_empty_names_are_rejected(client, references):
    invalid_unit = client.post(
        "/api/v1/batches",
        json=batch_payload(references, unit="gallon"),
    )
    empty_product = client.post("/api/v1/products", json={"name": "   "})
    empty_organization = client.post("/api/v1/organizations", json={"name": " "})

    assert invalid_unit.status_code == 422
    assert empty_product.status_code == 422
    assert empty_organization.status_code == 422


@pytest.mark.parametrize(
    ("reference_field", "unknown_id"),
    [("product_id", 999), ("origin_organization_id", 999)],
)
def test_missing_references_are_rejected(client, references, reference_field, unknown_id):
    response = client.post(
        "/api/v1/batches",
        json=batch_payload(references, **{reference_field: unknown_id}),
    )

    assert response.status_code == 404


def test_list_paginates_filters_and_searches(client, references):
    second_product = client.post("/api/v1/products", json={"name": "Rice"}).json()
    client.post("/api/v1/batches", json=batch_payload(references))
    client.post(
        "/api/v1/batches",
        json=batch_payload(
            references,
            batch_code="RCE-200",
            product_id=second_product["id"],
            origin_location="South Warehouse",
            quantity="15.25",
            unit="kg",
        ),
    )

    first_page = client.get("/api/v1/batches?limit=1&offset=0")
    mango_search = client.get("/api/v1/batches?q=mango")
    location_search = client.get("/api/v1/batches?q=South%20Warehouse")

    assert first_page.status_code == 200
    assert first_page.json()["total"] == 2
    assert len(first_page.json()["items"]) == 1
    assert mango_search.json()["total"] == 1
    assert mango_search.json()["items"][0]["batch_code"] == "MNG-100"
    assert location_search.json()["items"][0]["batch_code"] == "RCE-200"


def test_list_rejects_out_of_range_pagination(client):
    too_many = client.get("/api/v1/batches?limit=101")
    too_far = client.get("/api/v1/batches?offset=10001")

    assert too_many.status_code == 422
    assert too_far.status_code == 422


def test_retrieval_and_not_found(client, references):
    client.post("/api/v1/batches", json=batch_payload(references))

    retrieved = client.get("/api/v1/batches/mng-100")
    missing = client.get("/api/v1/batches/MNG-404")

    assert retrieved.status_code == 200
    assert retrieved.json()["batch_code"] == "MNG-100"
    assert missing.status_code == 404


def test_permitted_updates_and_immutable_batch_code(client, references):
    client.post("/api/v1/batches", json=batch_payload(references))
    updated_product = client.post("/api/v1/products", json={"name": "Dried Mango"}).json()
    updated_organization = client.post(
        "/api/v1/organizations",
        json={"name": "Packing Co", "participant_type": "processor"},
    ).json()
    response = client.patch(
        "/api/v1/batches/MNG-100",
        json={
            "product_id": updated_product["id"],
            "origin_organization_id": updated_organization["id"],
            "quantity": "99.875",
            "unit": "g",
            "origin_location": "Packing Site",
        },
    )
    attempted_code_change = client.patch(
        "/api/v1/batches/MNG-100",
        json={"batch_code": "MNG-999"},
    )

    assert response.status_code == 200
    assert response.json()["quantity"] == "99.875"
    assert response.json()["unit"] == "g"
    assert response.json()["origin_location"] == "Packing Site"
    assert response.json()["product"]["name"] == "Dried Mango"
    assert response.json()["origin_organization"]["name"] == "Packing Co"
    assert attempted_code_change.status_code == 422


def test_update_rejects_missing_references_and_empty_patch(client, references):
    client.post("/api/v1/batches", json=batch_payload(references))

    missing_product = client.patch("/api/v1/batches/MNG-100", json={"product_id": 999})
    empty_patch = client.patch("/api/v1/batches/MNG-100", json={})

    assert missing_product.status_code == 404
    assert empty_patch.status_code == 422
