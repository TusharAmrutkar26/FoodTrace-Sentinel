from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import build_engine, get_db
from app.main import app
from app.models.user import User
from app.services.authentication import hash_password

BACKEND_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def migrated_engine():
    test_engine = build_engine("sqlite://", poolclass=StaticPool)
    alembic_config = Config(str(BACKEND_ROOT / "alembic.ini"))
    alembic_config.set_main_option(
        "script_location", str(BACKEND_ROOT / "alembic").replace("%", "%%")
    )
    with test_engine.connect() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "head")
    try:
        yield test_engine
    finally:
        test_engine.dispose()


@pytest.fixture
def db_session(migrated_engine):
    TestSession = sessionmaker(
        bind=migrated_engine,
        autoflush=False,
        expire_on_commit=False,
    )
    with TestSession() as session:
        yield session


@pytest.fixture
def client(migrated_engine):
    TestSession = sessionmaker(
        bind=migrated_engine,
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
            with TestSession.begin() as session:
                session.add(
                    User(
                        email="platform-admin@example.test",
                        password_hash=hash_password("TestOnlyPassphrase!123"),
                        organization_id=None,
                        role="platform_admin",
                    )
                )
            login = test_client.post(
                "/api/v1/auth/login",
                json={"email": "platform-admin@example.test", "password": "TestOnlyPassphrase!123"},
            )
            assert login.status_code == 200
            test_client.headers["X-CSRF-Token"] = login.json()["csrf_token"]
            yield test_client
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def anonymous_client(client):
    """A separate client with no session cookie, sharing the isolated test DB."""
    with TestClient(app) as test_client:
        yield test_client


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
