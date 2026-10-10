from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import build_engine, get_db
from app.main import app

BACKEND_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def client():
    test_engine = build_engine("sqlite://", poolclass=StaticPool)
    alembic_config = Config(str(BACKEND_ROOT / "alembic.ini"))
    alembic_config.set_main_option(
        "script_location", str(BACKEND_ROOT / "alembic").replace("%", "%%")
    )
    with test_engine.connect() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "head")
    TestSession = sessionmaker(
        bind=test_engine,
        autoflush=False,
        expire_on_commit=False,
    )

    def override_get_db():
        with TestSession() as session:
            try:
                yield session
            except Exception:
                session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_db, None)
        test_engine.dispose()


@pytest.fixture
def references(client):
    organization_response = client.post(
        "/api/v1/organizations",
        json={"name": "North Farm", "participant_type": "farm"},
    )
    product_response = client.post("/api/v1/products", json={"name": "Mango"})
    assert organization_response.status_code == 201
    assert product_response.status_code == 201
    return {
        "organization_id": organization_response.json()["id"],
        "product_id": product_response.json()["id"],
    }


def batch_payload(references, **overrides):
    payload = {
        "batch_code": "MNG-100",
        "product_id": references["product_id"],
        "origin_organization_id": references["organization_id"],
        "origin_location": "North Farm, Field 2",
        "quantity": "100.000",
        "unit": "kg",
    }
    payload.update(overrides)
    return payload
