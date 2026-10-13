from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.config import AUTH_INVITATION_TTL_HOURS, AUTH_SESSION_TTL_HOURS
from app.models.organization import Organization
from app.models.user import User
from app.models.user_invitation import UserInvitation
from app.models.user_session import UserSession
from app.schemas.auth import InvitationCreate, RegistrationInput, normalize_email

password_hasher = PasswordHasher()
_dummy_password_hash = password_hasher.hash(secrets.token_urlsafe(32))


class InvalidCredentials(Exception):
    pass


class InvalidInvitation(Exception):
    pass


class InvitationNotAllowed(Exception):
    pass


class DuplicateAccount(Exception):
    pass


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _aware_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def verify_login(session: Session, *, email: str, password: str) -> User:
    normalized = normalize_email(email)
    user = session.scalar(
        select(User).options(joinedload(User.organization)).where(User.email == normalized)
    )
    password_hash = user.password_hash if user is not None else _dummy_password_hash
    valid = verify_password(password_hash, password)
    if user is None or not valid or not user.is_active:
        raise InvalidCredentials
    if password_hasher.check_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
        session.commit()
    return user


def create_session(session: Session, user: User) -> tuple[UserSession, str, str]:
    session_token = secrets.token_urlsafe(48)
    csrf_token = secrets.token_urlsafe(32)
    row = UserSession(
        user_id=user.id,
        token_hash=token_digest(session_token),
        csrf_token=csrf_token,
        expires_at=utc_now() + timedelta(hours=AUTH_SESSION_TTL_HOURS),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row, session_token, csrf_token


def rotate_csrf_token(session: Session, auth_session: UserSession) -> str:
    return auth_session.csrf_token


def revoke_session(session: Session, auth_session: UserSession) -> None:
    auth_session.revoked_at = utc_now()
    session.commit()


def create_invitation(
    session: Session,
    *,
    actor: User,
    payload: InvitationCreate,
) -> tuple[UserInvitation, str]:
    if actor.role not in {"platform_admin", "org_admin"}:
        raise InvitationNotAllowed
    organization_id = payload.organization_id if actor.role == "platform_admin" else actor.organization_id
    if organization_id is None:
        raise InvitationNotAllowed
    if actor.role == "org_admin" and payload.role == "org_admin":
        raise InvitationNotAllowed
    organization = session.get(Organization, organization_id)
    if organization is None:
        raise InvalidInvitation
    if actor.role == "org_admin" and organization.id != actor.organization_id:
        raise InvitationNotAllowed

    normalized_email = normalize_email(payload.email)
    if session.scalar(select(User.id).where(User.email == normalized_email)) is not None:
        raise InvalidInvitation
    raw_token = secrets.token_urlsafe(40)
    invitation = UserInvitation(
        email=normalized_email,
        organization_id=organization.id,
        role=payload.role,
        token_hash=token_digest(raw_token),
        created_by_user_id=actor.id,
        expires_at=utc_now() + timedelta(hours=AUTH_INVITATION_TTL_HOURS),
    )
    session.add(invitation)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise InvalidInvitation from None
    session.refresh(invitation)
    return invitation, raw_token


def register_with_invitation(
    session: Session, payload: RegistrationInput
) -> tuple[User, UserSession, str, str]:
    if payload.invitation_token is None:
        raise InvalidInvitation
    invitation = session.scalar(
        select(UserInvitation)
        .options(joinedload(UserInvitation.organization))
        .where(UserInvitation.token_hash == token_digest(payload.invitation_token))
    )
    now = utc_now()
    if invitation is None or invitation.used_at is not None or _aware_utc(invitation.expires_at) <= now:
        raise InvalidInvitation
    if session.scalar(select(User.id).where(User.email == invitation.email)) is not None:
        raise InvalidInvitation

    reserved = session.execute(
        update(UserInvitation)
        .where(
            UserInvitation.id == invitation.id,
            UserInvitation.used_at.is_(None),
            UserInvitation.expires_at > now,
        )
        .values(used_at=now)
        .execution_options(synchronize_session=False)
    )
    if reserved.rowcount != 1:
        session.rollback()
        raise InvalidInvitation

    user = User(
        email=invitation.email,
        password_hash=hash_password(payload.password),
        organization_id=invitation.organization_id,
        role=invitation.role,
    )
    session.add(user)
    try:
        session.flush()
        session.refresh(invitation)
        session.commit()
    except IntegrityError:
        session.rollback()
        raise InvalidInvitation from None
    session.refresh(user)
    session.refresh(invitation)
    user.organization = invitation.organization
    user_session, session_token, csrf_token = create_session(session, user)
    return user, user_session, session_token, csrf_token


def register_account(
    session: Session, payload: RegistrationInput
) -> tuple[User, UserSession, str, str]:
    """Register an invited member or an unassigned, least-privilege account."""
    if payload.invitation_token is not None:
        if payload.email is not None:
            invitation = session.scalar(
                select(UserInvitation).where(
                    UserInvitation.token_hash == token_digest(payload.invitation_token)
                )
            )
            if invitation is None or normalize_email(payload.email) != invitation.email:
                raise InvalidInvitation
        return register_with_invitation(session, payload)

    if payload.email is None:
        raise InvalidInvitation
    email = normalize_email(payload.email)
    if session.scalar(select(User.id).where(User.email == email)) is not None:
        raise DuplicateAccount

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        organization_id=None,
        role="viewer",
    )
    session.add(user)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise DuplicateAccount from None
    session.refresh(user)
    user_session, session_token, csrf_token = create_session(session, user)
    return user, user_session, session_token, csrf_token


def authenticated_session(session: Session, token: str | None) -> tuple[UserSession, User] | None:
    if not token:
        return None
    row = session.scalar(
        select(UserSession)
        .options(joinedload(UserSession.user).joinedload(User.organization))
        .where(UserSession.token_hash == token_digest(token))
    )
    if row is None or row.revoked_at is not None or _aware_utc(row.expires_at) <= utc_now() or not row.user.is_active:
        return None
    return row, row.user
