from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_csrf, require_org_access, require_roles
from app.db.session import get_db
from app.models.batch import Batch
from app.models.batch_event import BatchEvent
from app.models.user import User
from app.schemas.batch_event import BatchEventPage, BatchEventRead, EventCreate
from app.services.batch_events import (
    EventBatchMissing,
    EventOrganizationMissing,
    create_event,
    list_events,
)

router = APIRouter(dependencies=[Depends(get_current_user)])
DbSession = Annotated[Session, Depends(get_db)]
BatchCodePath = Annotated[str, Path(min_length=1, max_length=64)]
PageLimit = Annotated[int, Query(ge=1, le=100)]
PageOffset = Annotated[int, Query(ge=0, le=10000)]


@router.post(
    "/batches/{batch_code}/events",
    response_model=BatchEventRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_csrf), Depends(require_roles("platform_admin", "org_admin", "operator"))],
)
def create_batch_event(
    batch_code: BatchCodePath,
    payload: EventCreate,
    session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
) -> BatchEvent:
    batch = session.scalar(select(Batch).where(Batch.batch_code == batch_code.strip().upper()))
    if batch is not None:
        require_org_access(actor, batch.origin_organization_id)
    if actor.role != "platform_admin" and payload.organization_id is not None and payload.organization_id != actor.organization_id:
        raise HTTPException(status_code=404, detail="The requested organization was not found")
    try:
        return create_event(session, batch_code, payload)
    except EventBatchMissing as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except EventOrganizationMissing as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/batches/{batch_code}/events", response_model=BatchEventPage)
def get_batch_events(
    batch_code: BatchCodePath,
    session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
    limit: PageLimit = 50,
    offset: PageOffset = 0,
) -> BatchEventPage:
    batch = session.scalar(select(Batch).where(Batch.batch_code == batch_code.strip().upper()))
    if batch is not None:
        require_org_access(actor, batch.origin_organization_id)
    result = list_events(session, batch_code, limit=limit, offset=offset)
    if result is None:
        raise HTTPException(status_code=404, detail="Batch was not found")
    events, total = result
    return BatchEventPage(
        items=events,
        total=total,
        limit=limit,
        offset=offset,
    )
