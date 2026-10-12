from __future__ import annotations

import hmac
from dataclasses import dataclass
from typing import Annotated, Callable

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import AUTH_COOKIE_NAME
from app.db.session import get_db
from app.models.user import User
from app.models.user_session import UserSession
from app.services.authentication import authenticated_session, token_digest


@dataclass(frozen=True)
class AuthContext:
    session: UserSession
    user: User


DbSession = Annotated[Session, Depends(get_db)]


def get_auth_context(request: Request, session: DbSession) -> AuthContext:
    current = authenticated_session(session, request.cookies.get(AUTH_COOKIE_NAME))
    if current is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication is required",
            headers={"WWW-Authenticate": "Cookie"},
        )
    auth_session, user = current
    request.state.auth_user = user
    return AuthContext(session=auth_session, user=user)


def get_current_user(context: Annotated[AuthContext, Depends(get_auth_context)]) -> User:
    return context.user


def require_csrf(
    context: Annotated[AuthContext, Depends(get_auth_context)],
    csrf_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> User:
    if not csrf_token or not hmac.compare_digest(csrf_token, context.session.csrf_token):
        raise HTTPException(status_code=403, detail="The request could not be verified. Refresh your session and try again.")
    return context.user


def require_roles(*roles: str) -> Callable[..., User]:
    def dependency(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="You do not have permission to perform this action")
        return user

    return dependency


def require_org_access(user: User, organization_id: int) -> None:
    if user.role != "platform_admin" and user.organization_id != organization_id:
        # Use 404 so private cross-organization records are not disclosed.
        raise HTTPException(status_code=404, detail="The requested record was not found")


def organization_scope(user: User) -> int | None:
    if user.role == "platform_admin":
        return None
    # Treat an invalid/misconfigured member as having no matching organization,
    # never as a request for an unfiltered global result.
    return user.organization_id if user.organization_id is not None else -1
