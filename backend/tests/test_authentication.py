from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.config import (
    AUTH_COOKIE_NAME,
    AUTH_COOKIE_SECURE,
    FRONTEND_ORIGINS,
    parse_auth_cookie_secure,
    parse_frontend_origins,
)
from app.models.user import User
from app.models.user_invitation import UserInvitation
from app.models.user_session import UserSession
from app.services.authentication import token_digest, verify_password


def _create_invitation(client, organization_id: int, *, email="new-user@example.test", role="operator"):
    response = client.post(
        "/api/v1/auth/invitations",
        json={"email": email, "role": role, "organization_id": organization_id},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_passwords_use_argon2id_and_invalid_credentials_are_generic(client, db_session):
    stored = db_session.scalar(select(User).where(User.email == "platform-admin@example.test"))
    assert stored is not None
    assert stored.password_hash.startswith("$argon2id$")
    assert "TestOnlyPassphrase!123" not in stored.password_hash
    assert verify_password(stored.password_hash, "TestOnlyPassphrase!123")
    assert not verify_password(stored.password_hash, "another incorrect passphrase")

    missing = client.post(
        "/api/v1/auth/login",
        json={"email": "unknown@example.test", "password": "WrongPassphrase!123"},
    )
    wrong = client.post(
        "/api/v1/auth/login",
        json={"email": "platform-admin@example.test", "password": "WrongPassphrase!123"},
    )
    assert missing.status_code == wrong.status_code == 401
    assert missing.json() == wrong.json()


def test_invitation_token_is_hashed_and_registration_is_single_use(client, anonymous_client, references, db_session):
    invitation = _create_invitation(client, references["organization_id"])
    stored = db_session.scalar(
        select(UserInvitation).where(UserInvitation.email == "new-user@example.test")
    )
    assert stored is not None
    assert stored.token_hash == token_digest(invitation["invitation_token"])
    assert stored.token_hash != invitation["invitation_token"]
    assert invitation["role"] == "operator"
    assert invitation["organization"]["id"] == references["organization_id"]

    registered = anonymous_client.post(
        "/api/v1/auth/register",
        json={"invitation_token": invitation["invitation_token"], "password": "A-long-test-password!"},
    )
    assert registered.status_code == 201, registered.text
    assert registered.json()["user"]["email"] == "new-user@example.test"
    assert registered.json()["user"]["organization"]["id"] == references["organization_id"]
    assert registered.cookies.get(AUTH_COOKIE_NAME)
    assert "HttpOnly" in registered.headers["set-cookie"]
    assert "SameSite=lax" in registered.headers["set-cookie"]
    assert ("Secure" in registered.headers["set-cookie"]) is AUTH_COOKIE_SECURE
    assert anonymous_client.get("/api/v1/auth/me").status_code == 200

    reused = anonymous_client.post(
        "/api/v1/auth/register",
        json={"invitation_token": invitation["invitation_token"], "password": "Another-long-test!123"},
    )
    assert reused.status_code == 400
    assert "invalid or has expired" in reused.json()["detail"]
    db_session.expire_all()
    assert db_session.get(UserInvitation, stored.id).used_at is not None


def test_expired_and_unknown_invitations_are_rejected(client, anonymous_client, references, db_session):
    invitation = _create_invitation(client, references["organization_id"], email="expired@example.test")
    stored = db_session.scalar(
        select(UserInvitation).where(UserInvitation.email == "expired@example.test")
    )
    stored.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()

    expired = anonymous_client.post(
        "/api/v1/auth/register",
        json={"invitation_token": invitation["invitation_token"], "password": "A-long-test-password!"},
    )
    unknown = anonymous_client.post(
        "/api/v1/auth/register",
        json={"invitation_token": "x" * 48, "password": "A-long-test-password!"},
    )
    assert expired.status_code == unknown.status_code == 400
    assert expired.json() == unknown.json()


def test_session_validation_logout_revocation_and_csrf(client, db_session):
    current = client.get("/api/v1/auth/me")
    assert current.status_code == 200
    csrf = current.json()["csrf_token"]
    assert csrf == client.headers["X-CSRF-Token"]

    protected_mutation_without_csrf = client.post(
        "/api/v1/organizations", json={"name": "CSRF blocked", "participant_type": "farm"},
        headers={"X-CSRF-Token": "incorrect"},
    )
    assert protected_mutation_without_csrf.status_code == 403

    session_row = db_session.scalar(select(UserSession))
    assert session_row is not None and session_row.revoked_at is None
    cookie_token = client.cookies.get(AUTH_COOKIE_NAME)
    assert cookie_token
    assert session_row.token_hash == token_digest(cookie_token)
    assert session_row.token_hash != cookie_token
    logout = client.post("/api/v1/auth/logout")
    assert logout.status_code == 204
    db_session.expire_all()
    assert db_session.get(UserSession, session_row.id).revoked_at is not None
    assert client.get("/api/v1/auth/me").status_code == 401


def test_expired_sessions_are_rejected(client, db_session):
    row = db_session.scalar(select(UserSession))
    assert row is not None
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()
    assert client.get("/api/v1/auth/me").status_code == 401


def test_private_route_groups_require_auth_but_health_and_public_trace_remain_public(anonymous_client):
    paths = [
        "/api/v1/organizations",
        "/api/v1/products",
        "/api/v1/batches",
        "/api/v1/batches/UNKNOWN/events",
        "/api/v1/batches/UNKNOWN/genealogy",
        "/api/v1/batches/UNKNOWN/trace?direction=upstream",
        "/api/v1/batches/UNKNOWN/qr",
        "/api/v1/trust/findings",
        "/api/v1/reports/supply-chain",
        "/api/v1/recall-incidents",
    ]
    for path in paths:
        assert anonymous_client.get(path).status_code == 401, path
    assert anonymous_client.get("/health").json() == {"status": "ok"}
    assert anonymous_client.get(f"/api/v1/public-traces/{'f' * 32}").status_code == 404
    assert anonymous_client.post(
        "/api/v1/recalls/simulate",
        json={"root_batch_code": "NO-SUCH-BATCH", "max_depth": 10},
    ).status_code == 401
    assert anonymous_client.post(
        "/api/v1/auth/invitations",
        json={"email": "nobody@example.test", "role": "viewer", "organization_id": 1},
    ).status_code == 401


def test_invited_user_is_limited_to_own_organization_and_role(client, anonymous_client, references):
    other_organization = client.post(
        "/api/v1/organizations",
        json={"name": "Private Other Organization", "participant_type": "supplier"},
    ).json()
    product = client.post("/api/v1/products", json={"name": "Protected global product"}).json()
    batch = client.post(
        "/api/v1/batches",
        json={
            "batch_code": "PRIVATE-ORG-BATCH",
            "product_id": product["id"],
            "origin_organization_id": other_organization["id"],
            "origin_location": "Test location",
            "quantity": "1.000",
            "unit": "kg",
        },
    )
    assert batch.status_code == 201
    invitation = _create_invitation(
        client,
        references["organization_id"],
        email="read-only@example.test",
        role="viewer",
    )
    registered = anonymous_client.post(
        "/api/v1/auth/register",
        json={"invitation_token": invitation["invitation_token"], "password": "A-long-test-password!"},
    )
    assert registered.status_code == 201
    anonymous_client.headers["X-CSRF-Token"] = registered.json()["csrf_token"]

    visible_organizations = anonymous_client.get("/api/v1/organizations").json()["items"]
    assert len(visible_organizations) == 1
    assert visible_organizations[0]["id"] == invitation["organization"]["id"]
    assert anonymous_client.get("/api/v1/batches?limit=100").json()["total"] == 0
    assert anonymous_client.get(f"/api/v1/batches/{batch.json()['batch_code']}").status_code == 404
    denied = anonymous_client.post(
        "/api/v1/batches",
        json={
            "batch_code": "VIEWER-CANNOT-CREATE",
            "product_id": product["id"],
            "origin_organization_id": references["organization_id"],
            "origin_location": "Test location",
            "quantity": "1.000",
            "unit": "kg",
        },
    )
    assert denied.status_code == 403


def test_recall_review_actor_is_taken_from_authenticated_user(client, anonymous_client, references):
    batch = client.post(
        "/api/v1/batches",
        json={
            "batch_code": "REVIEW-IDENTITY-BATCH",
            "product_id": references["product_id"],
            "origin_organization_id": references["organization_id"],
            "origin_location": "Farm",
            "quantity": "10.000",
            "unit": "kg",
        },
    ).json()
    incident = client.post(
        "/api/v1/recall-incidents",
        json={"root_batch_code": batch["batch_code"], "reason": "Review identity test", "created_by": "forged name"},
    )
    assert incident.status_code == 201, incident.text
    assert incident.json()["created_by_verified"] is True
    invitation = _create_invitation(
        client, references["organization_id"], email="reviewer@example.test", role="reviewer"
    )
    registration = anonymous_client.post(
        "/api/v1/auth/register",
        json={"invitation_token": invitation["invitation_token"], "password": "A-long-test-password!"},
    )
    assert registration.status_code == 201
    anonymous_client.headers["X-CSRF-Token"] = registration.json()["csrf_token"]
    reviewed = anonymous_client.post(
        f"/api/v1/recall-incidents/{incident.json()['reference_id']}/reviews",
        json={"decision": "requires_investigation", "reviewer_name": "forged name", "notes": "Check records"},
    )
    assert reviewed.status_code == 201, reviewed.text
    review = reviewed.json()["reviews"][0]
    assert review["reviewer_name"] == "reviewer@example.test"
    assert review["reviewer_identity_verified"] is True


def test_cors_is_explicit_and_frontend_origin_configuration_rejects_wildcards(anonymous_client):
    origin = FRONTEND_ORIGINS[0]
    preflight = anonymous_client.options(
        "/api/v1/auth/login",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-csrf-token",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == origin
    assert preflight.headers["access-control-allow-credentials"] == "true"

    disallowed = anonymous_client.options(
        "/api/v1/auth/login",
        headers={"Origin": "https://untrusted.invalid", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in disallowed.headers

    try:
        parse_frontend_origins("*", production=False)
        assert False, "wildcard CORS origins must be rejected"
    except ValueError:
        pass
    try:
        parse_frontend_origins("http://localhost:5173/path", production=False)
        assert False, "CORS paths must be rejected"
    except ValueError:
        pass
    try:
        parse_frontend_origins("http://localhost:5173", production=True)
        assert False, "production origins must use HTTPS"
    except ValueError:
        pass
    try:
        parse_frontend_origins("https://*.example.invalid", production=True)
        assert False, "subdomain wildcards must be rejected"
    except ValueError:
        pass
    assert parse_auth_cookie_secure(None, production=True) is True
    try:
        parse_auth_cookie_secure("false", production=True)
        assert False, "production sessions must use secure cookies"
    except ValueError:
        pass
