def test_catalog_creation_validation_and_existing_duplicate_rules(client):
    product = client.post("/api/v1/products", json={"name": "Tomato"})
    organization = client.post(
        "/api/v1/organizations",
        json={"name": "Green Valley Farms", "participant_type": "supplier"},
    )
    empty_product = client.post("/api/v1/products", json={"name": "  "})
    empty_organization = client.post(
        "/api/v1/organizations",
        json={"name": "Green Valley", "participant_type": " "},
    )

    assert product.status_code == 201
    assert product.json()["name"] == "Tomato"
    assert organization.status_code == 201
    assert organization.json()["participant_type"] == "supplier"
    assert empty_product.status_code == 422
    assert empty_organization.status_code == 422

    # The existing catalog schema has no unique-name constraint. Keep that
    # behavior; the seed command separately reuses matching natural names.
    duplicate_product = client.post("/api/v1/products", json={"name": "Tomato"})
    duplicate_organization = client.post(
        "/api/v1/organizations",
        json={"name": "Green Valley Farms", "participant_type": "supplier"},
    )
    assert duplicate_product.status_code == 201
    assert duplicate_product.json()["id"] != product.json()["id"]
    assert duplicate_organization.status_code == 201
    assert duplicate_organization.json()["id"] != organization.json()["id"]


def test_catalog_lists_are_paginated_and_include_created_records(client):
    client.post("/api/v1/products", json={"name": "Rice"})
    client.post("/api/v1/organizations", json={"name": "Sunrise Agro"})

    products = client.get("/api/v1/products?limit=1&offset=0")
    organizations = client.get("/api/v1/organizations?limit=1&offset=0")

    assert products.status_code == 200
    assert products.json()["total"] == 1
    assert products.json()["items"][0]["name"] == "Rice"
    assert organizations.status_code == 200
    assert organizations.json()["total"] == 1
    assert organizations.json()["items"][0]["name"] == "Sunrise Agro"
