from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models.batch import Batch
from app.models.batch_event import BatchEvent
from app.models.organization import Organization
from app.schemas.batch_event import EventCreate


class EventBatchMissing(Exception):
    """Raised when an event refers to a batch that does not exist."""


class EventOrganizationMissing(Exception):
    """Raised when an event refers to an organization that does not exist."""


def _find_batch(session: Session, batch_code: str) -> Batch | None:
    return session.scalar(
        select(Batch).where(Batch.batch_code == batch_code.strip().upper())
    )


def create_event(session: Session, batch_code: str, payload: EventCreate) -> BatchEvent:
    batch = _find_batch(session, batch_code)
    if batch is None:
        raise EventBatchMissing("Batch was not found")
    if payload.organization_id is not None and session.get(
        Organization, payload.organization_id
    ) is None:
        raise EventOrganizationMissing("Event organization was not found")

    occurred_at = payload.occurred_at or datetime.now(timezone.utc)
    event = BatchEvent(
        batch_id=batch.id,
        event_type=payload.event_type.value,
        occurred_at=occurred_at,
        organization_id=payload.organization_id,
        location=payload.location,
        notes=payload.notes,
    )
    session.add(event)
    session.commit()
    return session.scalar(
        select(BatchEvent)
        .options(joinedload(BatchEvent.organization))
        .where(BatchEvent.id == event.id)
    )  # type: ignore[return-value]


def list_events(
    session: Session,
    batch_code: str,
    *,
    limit: int,
    offset: int,
) -> tuple[list[BatchEvent], int] | None:
    batch = _find_batch(session, batch_code)
    if batch is None:
        return None

    total = session.scalar(
        select(func.count(BatchEvent.id)).where(BatchEvent.batch_id == batch.id)
    ) or 0
    events = session.scalars(
        select(BatchEvent)
        .options(joinedload(BatchEvent.organization))
        .where(BatchEvent.batch_id == batch.id)
        .order_by(BatchEvent.occurred_at, BatchEvent.id)
        .limit(limit)
        .offset(offset)
    ).all()
    return list(events), total
