from datetime import datetime, timedelta, timezone
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import build_engine
from app.models.organization import Organization
from app.models.user import User
from app.models.user_invitation import UserInvitation
from app.models.user_session import UserSession

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _upgrade(engine, revision: str) -> None:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic").replace("%", "%%"))
    with engine.connect() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, revision)


def test_self_registration_migration_preserves_existing_users_and_sessions():
    engine = build_engine("sqlite://", poolclass=StaticPool)
    try:
        _upgrade(engine, "20261011_0005")
        Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        with Session.begin() as session:
            organization = Organization(name="Existing organization", participant_type="supplier")
            session.add(organization)
            session.flush()
            admin = User(
                email="existing-admin@example.test",
                password_hash="existing-password-hash",
                organization_id=None,
                role="platform_admin",
            )
            member = User(
                email="existing-member@example.test",
                password_hash="existing-member-hash",
                organization_id=organization.id,
                role="viewer",
            )
            session.add_all([admin, member])
            session.flush()
            member_session = UserSession(
                user_id=member.id,
                token_hash="a" * 64,
                csrf_token="b" * 64,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(member_session)
            invitation = UserInvitation(
                email="existing-invite@example.test",
                organization_id=organization.id,
                role="viewer",
                token_hash="c" * 64,
                created_by_user_id=admin.id,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(invitation)
            session.flush()

        _upgrade(engine, "head")

        with Session() as session:
            assert session.get(User, admin.id).email == "existing-admin@example.test"
            assert session.get(User, member.id).organization_id == organization.id
            assert session.get(UserSession, member_session.id).user_id == member.id
            assert session.get(UserInvitation, invitation.id).created_by_user_id == admin.id
            unassigned = User(
                email="new-unassigned@example.test",
                password_hash="new-password-hash",
                organization_id=None,
                role="viewer",
            )
            session.add(unassigned)
            session.commit()
            assert session.scalar(text("PRAGMA foreign_key_check")) is None
            assert session.scalar(text("PRAGMA foreign_keys")) == 1
    finally:
        engine.dispose()
