from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_csrf, require_roles
from app.db.session import get_db
from app.models.organization import Organization
from app.models.user import User
from app.schemas.organization import OrganizationCreate, OrganizationPage, OrganizationRead

router = APIRouter(dependencies=[Depends(get_current_user)])
DbSession = Annotated[Session, Depends(get_db)]
PageLimit = Annotated[int, Query(ge=1, le=100)]
PageOffset = Annotated[int, Query(ge=0, le=10000)]


@router.post("", response_model=OrganizationRead, status_code=201, dependencies=[Depends(require_csrf), Depends(require_roles("platform_admin"))])
def create_organization(payload: OrganizationCreate, session: DbSession) -> Organization:
    organization = Organization(**payload.model_dump())
    session.add(organization)
    session.commit()
    session.refresh(organization)
    return organization


@router.get("", response_model=OrganizationPage)
def list_organizations(
    session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
    limit: PageLimit = 20,
    offset: PageOffset = 0,
) -> OrganizationPage:
    statement = select(Organization)
    count_statement = select(func.count(Organization.id))
    if actor.role != "platform_admin":
        statement = statement.where(Organization.id == actor.organization_id)
        count_statement = count_statement.where(Organization.id == actor.organization_id)
    total = session.scalar(count_statement) or 0
    items = session.scalars(
        statement
        .order_by(Organization.name, Organization.id)
        .limit(limit)
        .offset(offset)
    ).all()
    return OrganizationPage(items=list(items), total=total, limit=limit, offset=offset)
