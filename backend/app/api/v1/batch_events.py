from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.batch_event import BatchEvent
from app.schemas.batch_event import BatchEventPage, BatchEventRead, EventCreate
from app.services.batch_events import (
    EventBatchMissing,
    EventOrganizationMissing,
    create_event,
    list_events,
)

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]
BatchCodePath = Annotated[str, Path(min_length=1, max_length=64)]
PageLimit = Annotated[int, Query(ge=1, le=100)]
PageOffset = Annotated[int, Query(ge=0, le=10000)]


@router.post(
    "/batches/{batch_code}/events",
    response_model=BatchEventRead,
    status_code=status.HTTP_201_CREATED,
)
def create_batch_event(
    batch_code: BatchCodePath,
    payload: EventCreate,
    session: DbSession,
) -> BatchEvent:
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
    limit: PageLimit = 50,
    offset: PageOffset = 0,
) -> BatchEventPage:
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
