from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session, aliased

from app.models.batch import Batch
from app.models.batch_event import BatchEvent
from app.models.batch_genealogy import BatchGenealogy
from app.schemas.batch_event import EventType
from app.schemas.batch_genealogy import RelationshipType
from app.schemas.reports import (
    EventTypeCount,
    GenealogyTypeCount,
    ReportPeriod,
    SupplyChainReport,
    UnavailableMetric,
)

QUANTITY_UNAVAILABLE_REASON = (
    "Supply-chain events do not record quantities. Batch quantities are snapshots, "
    "and genealogy input quantities may describe the same food across multiple "
    "edges; the current schema cannot safely derive weekly production, movement, "
    "loss, or unique-food totals without double-counting or assuming meaning."
)
TRUST_UNAVAILABLE_REASON = (
    "TraceTrust findings are recomputed from current records and have no recorded "
    "finding timestamp or history, so findings cannot be attributed to this period."
)


def default_report_period(today: date | None = None) -> tuple[date, date]:
    """Return the seven complete UTC calendar dates before today, inclusive."""
    current_day = today or datetime.now(timezone.utc).date()
    return current_day - timedelta(days=7), current_day - timedelta(days=1)


def _utc_start(value: date) -> datetime:
    return datetime.combine(value, time.min, tzinfo=timezone.utc)


def build_supply_chain_report(
    session: Session,
    *,
    start_date: date,
    end_date: date,
    generated_at: datetime | None = None,
    organization_id: int | None = None,
) -> SupplyChainReport:
    """Aggregate only persisted records with timestamps that support this period."""
    start = _utc_start(start_date)
    end_exclusive = _utc_start(end_date + timedelta(days=1))

    batch_filter = [
            Batch.created_at >= start,
            Batch.created_at < end_exclusive,
        ]
    if organization_id is not None:
        batch_filter.append(Batch.origin_organization_id == organization_id)
    batches_created = session.scalar(select(func.count(Batch.id)).where(*batch_filter)) or 0

    event_statement = (
        select(BatchEvent.event_type, func.count(BatchEvent.id))
        .join(Batch, Batch.id == BatchEvent.batch_id)
        .where(
            BatchEvent.occurred_at >= start,
            BatchEvent.occurred_at < end_exclusive,
        )
        .group_by(BatchEvent.event_type)
    )
    if organization_id is not None:
        event_statement = event_statement.where(Batch.origin_organization_id == organization_id)
    event_rows = session.execute(event_statement).all()
    event_counts_by_type = {event_type: count for event_type, count in event_rows}
    event_counts = [
        EventTypeCount(event_type=event_type, count=event_counts_by_type.get(event_type.value, 0))
        for event_type in EventType
    ]
    activity_statement = (
        select(func.count(distinct(BatchEvent.batch_id)))
        .join(Batch, Batch.id == BatchEvent.batch_id)
        .where(
            BatchEvent.occurred_at >= start,
            BatchEvent.occurred_at < end_exclusive,
        )
    )
    if organization_id is not None:
        activity_statement = activity_statement.where(Batch.origin_organization_id == organization_id)
    batches_with_event_activity = session.scalar(activity_statement) or 0

    parent = aliased(Batch)
    child = aliased(Batch)
    genealogy_statement = (
        select(BatchGenealogy.relationship_type, func.count(BatchGenealogy.id))
        .join(parent, parent.id == BatchGenealogy.parent_batch_id)
        .join(child, child.id == BatchGenealogy.child_batch_id)
        .where(
            BatchGenealogy.created_at >= start,
            BatchGenealogy.created_at < end_exclusive,
        )
        .group_by(BatchGenealogy.relationship_type)
    )
    if organization_id is not None:
        genealogy_statement = genealogy_statement.where(
            parent.origin_organization_id == organization_id,
            child.origin_organization_id == organization_id,
        )
    genealogy_rows = session.execute(genealogy_statement).all()
    genealogy_counts_by_type = {
        relationship_type: count for relationship_type, count in genealogy_rows
    }
    genealogy_counts = [
        GenealogyTypeCount(
            relationship_type=relationship_type,
            count=genealogy_counts_by_type.get(relationship_type.value, 0),
        )
        for relationship_type in RelationshipType
    ]

    event_total = sum(item.count for item in event_counts)
    genealogy_total = sum(item.count for item in genealogy_counts)
    definitions = [
        "Batches created uses batches.created_at within the UTC period.",
        "Batches with event activity counts distinct batch records with at least one event whose occurred_at is within the UTC period.",
        "Event counts use each event's occurred_at timestamp; the response contains aggregate counts, not detailed event rows.",
        "Genealogy counts use the relationship row's created_at timestamp, which records when the link was saved, not necessarily when the physical operation occurred.",
        "Quantity metrics are unavailable: event rows have no quantity, and batch or genealogy quantities cannot safely represent unique weekly production or movement totals.",
        "TraceTrust findings are unavailable for historical periods because findings have no persisted timestamp or history.",
    ]
    warnings = [
        "No supply-chain event quantity is recorded by the current schema; no production, transfer, loss, or unique-food quantity is reported.",
        "Genealogy activity is counted when links were recorded; link creation time may differ from operation time.",
        "TraceTrust findings are current-state checks without historical attribution and are omitted from this period report.",
    ]

    return SupplyChainReport(
        period=ReportPeriod(start_date=start_date, end_date=end_date),
        generated_at=generated_at or datetime.now(timezone.utc),
        has_activity=bool(batches_created or event_total or genealogy_total),
        batches_created=batches_created,
        batches_with_event_activity=batches_with_event_activity,
        event_counts=event_counts,
        genealogy_counts=genealogy_counts,
        quantity_metrics=UnavailableMetric(reason=QUANTITY_UNAVAILABLE_REASON),
        trace_trust_findings=UnavailableMetric(reason=TRUST_UNAVAILABLE_REASON),
        definitions=definitions,
        warnings=warnings,
    )
