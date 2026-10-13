from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.config import TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT
from app.models.batch import Batch
from app.models.batch_event import BatchEvent
from app.models.batch_trace_identity import BatchTraceIdentity
from app.schemas.batch_genealogy import TraceDirection
from app.schemas.public_trace import (
    PublicBatchRead,
    PublicBatchTraceRead,
    PublicEventRead,
    PublicGenealogyRelationship,
    PublicTraceBatch,
    PublicTraceTrustFinding,
)
from app.services.batch_genealogy import get_genealogy, trace_genealogy
from app.services.trace_trust import get_trust_findings_for_batch_codes


def get_public_batch_trace(
    session: Session, trace_id: str
) -> PublicBatchTraceRead | None:
    identity = session.scalar(
        select(BatchTraceIdentity)
        .options(
            joinedload(BatchTraceIdentity.batch).joinedload(Batch.product),
            joinedload(BatchTraceIdentity.batch).joinedload(Batch.origin_organization),
        )
        .where(BatchTraceIdentity.trace_id == trace_id)
    )
    if identity is None:
        return None

    batch = identity.batch
    genealogy = get_genealogy(session, batch.batch_code)
    upstream = trace_genealogy(session, batch.batch_code, TraceDirection.UPSTREAM)
    downstream = trace_genealogy(session, batch.batch_code, TraceDirection.DOWNSTREAM)
    events = session.scalars(
        select(BatchEvent)
        .where(BatchEvent.batch_id == batch.id)
        .order_by(BatchEvent.occurred_at, BatchEvent.id)
    ).all()
    trust_findings = get_trust_findings_for_batch_codes(
        session,
        process_loss_threshold_percent=TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT,
        batch_codes=[batch.batch_code],
    )

    if genealogy is None or upstream is None or downstream is None:
        return None

    return PublicBatchTraceRead(
        batch=PublicBatchRead(
            batch_code=batch.batch_code,
            product_name=batch.product.name,
            quantity=batch.quantity,
            unit=batch.unit,
            origin_organization=batch.origin_organization.name,
            origin_location=batch.origin_location,
            created_at=batch.created_at,
        ),
        events=[
            PublicEventRead(
                event_type=event.event_type,
                occurred_at=event.occurred_at,
                location=event.location,
            )
            for event in events
        ],
        parents=[
            PublicGenealogyRelationship.from_genealogy_read(edge)
            for edge in genealogy.parents
        ],
        children=[
            PublicGenealogyRelationship.from_genealogy_read(edge)
            for edge in genealogy.children
        ],
        upstream=[
            PublicTraceBatch(**node.model_dump(exclude={"id"}))
            for node in upstream.batches
        ],
        downstream=[
            PublicTraceBatch(**node.model_dump(exclude={"id"}))
            for node in downstream.batches
        ],
        # Public QR pages receive only the selected batch's finding summary.
        # Internal finding IDs, related batch codes, evidence, and actions stay private.
        trace_trust_findings=[
            PublicTraceTrustFinding(
                check_type=finding.check_type,
                severity=finding.severity,
                status=finding.status,
                title=finding.title,
                explanation=finding.explanation,
            )
            for finding in trust_findings
        ],
    )
