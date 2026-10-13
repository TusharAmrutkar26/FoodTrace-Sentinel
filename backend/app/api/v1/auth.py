from datetime import timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.auth import AuthContext, DbSession, get_auth_context, get_current_user, require_csrf, require_roles
from app.core.config import AUTH_COOKIE_NAME, AUTH_COOKIE_SECURE, AUTH_SESSION_TTL_HOURS
from app.models.user import User
from app.schemas.auth import (
    AuthOrganization,
    AuthSessionRead,
    AuthUserRead,
    InvitationCreate,
    InvitationRead,
    LoginInput,
    RegistrationInput,
)
from app.services.authentication import (
    DuplicateAccount,
    InvalidCredentials,
    InvalidInvitation,
    InvitationNotAllowed,
    create_invitation,
    create_session,
    register_account,
    revoke_session,
    rotate_csrf_token,
    verify_login,
)

router = APIRouter()


def _user_read(user: User) -> AuthUserRead:
    return AuthUserRead(
        email=user.email,
        role=user.role,
        organization=(
            AuthOrganization(id=user.organization.id, name=user.organization.name)
            if user.organization is not None
            else None
        ),
    )


def _set_session_cookie(response: Response, session_token: str) -> None:
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=session_token,
        max_age=AUTH_SESSION_TTL_HOURS * 60 * 60,
        httponly=True,
        secure=AUTH_COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=AUTH_COOKIE_NAME,
        httponly=True,
        secure=AUTH_COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


@router.post("/auth/login", response_model=AuthSessionRead)
def login(payload: LoginInput, response: Response, session: DbSession) -> AuthSessionRead:
    try:
        user = verify_login(session, email=payload.email, password=payload.password)
    except InvalidCredentials as error:
        raise HTTPException(status_code=401, detail="Email or password is incorrect") from error
    _row, raw_session, csrf_token = create_session(session, user)
    _set_session_cookie(response, raw_session)
    return AuthSessionRead(user=_user_read(user), csrf_token=csrf_token)


@router.post("/auth/register", response_model=AuthSessionRead, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegistrationInput,
    response: Response,
    session: DbSession,
) -> AuthSessionRead:
    try:
        user, _row, raw_session, csrf_token = register_account(session, payload)
    except DuplicateAccount as error:
        raise HTTPException(status_code=409, detail="An account with this email already exists") from error
    except InvalidInvitation as error:
        raise HTTPException(status_code=400, detail="The invitation is invalid or has expired") from error
    _set_session_cookie(response, raw_session)
    return AuthSessionRead(user=_user_read(user), csrf_token=csrf_token)


@router.get("/auth/me", response_model=AuthSessionRead)
def me(
    context: Annotated[AuthContext, Depends(get_auth_context)],
    session: DbSession,
) -> AuthSessionRead:
    csrf_token = rotate_csrf_token(session, context.session)
    return AuthSessionRead(user=_user_read(context.user), csrf_token=csrf_token)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_csrf)])
def logout(
    response: Response,
    context: Annotated[AuthContext, Depends(get_auth_context)],
    session: DbSession,
) -> Response:
    revoke_session(session, context.session)
    _clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post(
    "/auth/invitations",
    response_model=InvitationRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_csrf)],
)
def invite_user(
    payload: InvitationCreate,
    session: DbSession,
    actor: Annotated[User, Depends(require_roles("platform_admin", "org_admin"))],
) -> InvitationRead:
    try:
        invitation, raw_token = create_invitation(session, actor=actor, payload=payload)
    except InvitationNotAllowed as error:
        raise HTTPException(status_code=403, detail="You do not have permission to issue this invitation") from error
    except InvalidInvitation as error:
        raise HTTPException(status_code=422, detail="The organization or invitation details are invalid") from error
    return InvitationRead(
        email=invitation.email,
        role=invitation.role,
        organization=AuthOrganization(
            id=invitation.organization.id,
            name=invitation.organization.name,
        ),
        invitation_token=raw_token,
        expires_at=invitation.expires_at.replace(tzinfo=timezone.utc)
        if invitation.expires_at.tzinfo is None
        else invitation.expires_at,
    )
