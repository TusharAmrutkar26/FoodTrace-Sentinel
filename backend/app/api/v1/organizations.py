from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.organization import Organization
from app.schemas.organization import OrganizationCreate, OrganizationPage, OrganizationRead

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]
PageLimit = Annotated[int, Query(ge=1, le=100)]
PageOffset = Annotated[int, Query(ge=0, le=10000)]


@router.post("", response_model=OrganizationRead, status_code=201)
def create_organization(payload: OrganizationCreate, session: DbSession) -> Organization:
    organization = Organization(**payload.model_dump())
    session.add(organization)
    session.commit()
    session.refresh(organization)
    return organization


@router.get("", response_model=OrganizationPage)
def list_organizations(
    session: DbSession,
    limit: PageLimit = 20,
    offset: PageOffset = 0,
) -> OrganizationPage:
    total = session.scalar(select(func.count(Organization.id))) or 0
    items = session.scalars(
        select(Organization)
        .order_by(Organization.name, Organization.id)
        .limit(limit)
        .offset(offset)
    ).all()
    return OrganizationPage(items=list(items), total=total, limit=limit, offset=offset)
