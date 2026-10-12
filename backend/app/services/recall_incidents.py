from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.batch import Batch
from app.models.recall_candidate_snapshot import RecallCandidateSnapshot
from app.models.recall_follow_up_action import RecallFollowUpAction
from app.models.recall_incident import RecallIncident
from app.models.recall_incident_history import RecallIncidentHistory
from app.models.recall_review import RecallReview
from app.models.user import User
from app.schemas.recall import RecallSimulationResponse
from app.schemas.recall_incident import (
    RecallFollowUpActionCreate,
    RecallFollowUpActionRead,
    RecallFollowUpActionUpdate,
    RecallIncidentDetail,
    RecallIncidentHistoryRead,
    RecallIncidentPage,
    RecallIncidentSummary,
    RecallReviewCreate,
    RecallReviewRead,
    RecallSnapshotCreate,
    RecallSnapshotRead,
)
from app.services.recalls import (
    RecallRootBatchMissing,
    simulate_recall,
)
from app.core.config import TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT


class RecallIncidentMissing(Exception):
    pass


class RecallIncidentBatchMissing(Exception):
    pass


class RecallActionMissing(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _history(
    incident_id: int,
    event_type: str,
    actor: User | None,
    details: dict[str, object],
) -> RecallIncidentHistory:
    return RecallIncidentHistory(
        incident_id=incident_id,
        event_type=event_type,
        actor_name=actor.email if actor else None,
        actor_user_id=actor.id if actor else None,
        details_json=json.dumps(details, sort_keys=True, separators=(",", ":")),
    )


def _summary(incident: RecallIncident) -> RecallIncidentSummary:
    return RecallIncidentSummary(
        reference_id=incident.reference_id,
        root_batch_code=incident.root_batch.batch_code,
        reason=incident.reason,
        status=incident.status,
        created_by=incident.created_by,
        created_by_verified=incident.created_by_user_id is not None,
        created_at=incident.created_at,
        updated_at=incident.updated_at,
    )


def _snapshot_read(row: RecallCandidateSnapshot) -> RecallSnapshotRead:
    return RecallSnapshotRead(
        id=row.id,
        captured_at=row.captured_at,
        simulated_at=row.simulated_at,
        max_depth=row.max_depth,
        simulation=RecallSimulationResponse.model_validate(json.loads(row.payload_json)),
    )


def _review_read(row: RecallReview) -> RecallReviewRead:
    return RecallReviewRead(
        id=row.id,
        decision=row.decision,
        notes=row.notes,
        reviewer_name=row.reviewer_name,
        reviewer_identity_verified=row.reviewer_user_id is not None,
        created_at=row.created_at,
    )


def _action_read(row: RecallFollowUpAction) -> RecallFollowUpActionRead:
    return RecallFollowUpActionRead(
        id=row.id,
        description=row.description,
        status=row.status,
        assignee=row.assignee,
        due_at=row.due_at,
        completion_notes=row.completion_notes,
        evidence_references=json.loads(row.evidence_references_json),
        created_at=row.created_at,
        updated_at=row.updated_at,
        completed_at=row.completed_at,
    )


def _history_read(row: RecallIncidentHistory) -> RecallIncidentHistoryRead:
    return RecallIncidentHistoryRead(
        id=row.id,
        event_type=row.event_type,
        actor_name=row.actor_name,
        actor_identity_verified=row.actor_user_id is not None,
        details=json.loads(row.details_json),
        recorded_at=row.recorded_at,
    )


def _load_incident(
    session: Session, reference_id: str, organization_id: int | None = None
) -> RecallIncident:
    statement = select(RecallIncident).where(RecallIncident.reference_id == reference_id)
    if organization_id is not None:
        statement = statement.join(Batch, RecallIncident.root_batch_id == Batch.id).where(
            Batch.origin_organization_id == organization_id
        )
    incident = session.scalar(statement)
    if incident is None:
        raise RecallIncidentMissing("The recall incident was not found")
    return incident


def _detail(session: Session, incident: RecallIncident) -> RecallIncidentDetail:
    snapshots = session.scalars(
        select(RecallCandidateSnapshot)
        .where(RecallCandidateSnapshot.incident_id == incident.id)
        .order_by(RecallCandidateSnapshot.captured_at, RecallCandidateSnapshot.id)
    ).all()
    reviews = session.scalars(
        select(RecallReview)
        .where(RecallReview.incident_id == incident.id)
        .order_by(RecallReview.created_at, RecallReview.id)
    ).all()
    actions = session.scalars(
        select(RecallFollowUpAction)
        .where(RecallFollowUpAction.incident_id == incident.id)
        .order_by(RecallFollowUpAction.created_at, RecallFollowUpAction.id)
    ).all()
    history = session.scalars(
        select(RecallIncidentHistory)
        .where(RecallIncidentHistory.incident_id == incident.id)
        .order_by(RecallIncidentHistory.recorded_at, RecallIncidentHistory.id)
    ).all()
    return RecallIncidentDetail(
        **_summary(incident).model_dump(),
        snapshots=[_snapshot_read(item) for item in snapshots],
        reviews=[_review_read(item) for item in reviews],
        actions=[_action_read(item) for item in actions],
        history=[_history_read(item) for item in history],
    )


def create_incident(
    session: Session,
    *,
    root_batch_code: str,
    reason: str,
    actor: User,
    organization_id: int | None = None,
) -> RecallIncidentDetail:
    statement = select(Batch).where(func.upper(Batch.batch_code) == root_batch_code.strip().upper())
    if organization_id is not None:
        statement = statement.where(Batch.origin_organization_id == organization_id)
    batch = session.scalar(statement)
    if batch is None:
        raise RecallIncidentBatchMissing("The selected root batch was not found")
    incident = RecallIncident(
        reference_id=f"RC-{uuid4().hex[:20].upper()}",
        root_batch_id=batch.id,
        reason=reason.strip(),
        created_by=actor.email,
        created_by_user_id=actor.id,
    )
    session.add(incident)
    session.flush()
    session.add(
        _history(
            incident.id,
            "incident_created",
            actor,
            {"root_batch_code": batch.batch_code, "status": "pending_review"},
        )
    )
    session.commit()
    session.refresh(incident)
    return _detail(session, incident)


def list_incidents(
    session: Session,
    *,
    limit: int,
    offset: int,
    status_filter: str | None = None,
    organization_id: int | None = None,
) -> RecallIncidentPage:
    statement = select(RecallIncident)
    count_statement = select(func.count(RecallIncident.id))
    if organization_id is not None:
        statement = statement.join(Batch, RecallIncident.root_batch_id == Batch.id).where(
            Batch.origin_organization_id == organization_id
        )
        count_statement = count_statement.join(Batch, RecallIncident.root_batch_id == Batch.id).where(
            Batch.origin_organization_id == organization_id
        )
    if status_filter:
        statement = statement.where(RecallIncident.status == status_filter)
        count_statement = count_statement.where(RecallIncident.status == status_filter)
    items = session.scalars(
        statement.order_by(RecallIncident.created_at.desc(), RecallIncident.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return RecallIncidentPage(
        items=[_summary(item) for item in items],
        total=session.scalar(count_statement) or 0,
        limit=limit,
        offset=offset,
    )


def get_incident(
    session: Session, reference_id: str, organization_id: int | None = None
) -> RecallIncidentDetail:
    return _detail(session, _load_incident(session, reference_id, organization_id))


def get_incident_history(
    session: Session, reference_id: str, organization_id: int | None = None
) -> list[RecallIncidentHistoryRead]:
    incident = _load_incident(session, reference_id, organization_id)
    rows = session.scalars(
        select(RecallIncidentHistory)
        .where(RecallIncidentHistory.incident_id == incident.id)
        .order_by(RecallIncidentHistory.recorded_at, RecallIncidentHistory.id)
    ).all()
    return [_history_read(row) for row in rows]


def capture_snapshot(
    session: Session,
    *,
    reference_id: str,
    max_depth: int,
    actor: User,
    organization_id: int | None = None,
) -> RecallSnapshotRead:
    incident = _load_incident(session, reference_id, organization_id)
    simulation = simulate_recall(
        session,
        root_batch_code=incident.root_batch.batch_code,
        max_depth=max_depth,
        process_loss_threshold_percent=TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT,
    )
    row = RecallCandidateSnapshot(
        incident_id=incident.id,
        simulated_at=simulation.simulated_at,
        max_depth=max_depth,
        payload_json=simulation.model_dump_json(),
    )
    session.add(row)
    session.flush()
    session.add(
        _history(
            incident.id,
            "candidate_scope_captured",
            actor,
            {"snapshot_id": row.id, "max_depth": max_depth},
        )
    )
    session.commit()
    session.refresh(row)
    return _snapshot_read(row)


def record_review(
    session: Session,
    *,
    reference_id: str,
    payload: RecallReviewCreate,
    actor: User,
    organization_id: int | None = None,
) -> RecallIncidentDetail:
    incident = _load_incident(session, reference_id, organization_id)
    review = RecallReview(
        incident_id=incident.id,
        decision=payload.decision,
        notes=payload.notes.strip() if payload.notes else None,
        reviewer_name=actor.email,
        reviewer_user_id=actor.id,
    )
    incident.status = payload.decision
    incident.updated_at = _now()
    session.add(review)
    session.flush()
    session.add(
        _history(
            incident.id,
            "review_recorded",
            actor,
            {"review_id": review.id, "decision": review.decision},
        )
    )
    session.commit()
    session.refresh(incident)
    return _detail(session, incident)


def add_follow_up_action(
    session: Session,
    *,
    reference_id: str,
    payload: RecallFollowUpActionCreate,
    actor: User,
    organization_id: int | None = None,
) -> RecallIncidentDetail:
    incident = _load_incident(session, reference_id, organization_id)
    action = RecallFollowUpAction(
        incident_id=incident.id,
        description=payload.description.strip(),
        assignee=payload.assignee.strip() if payload.assignee else None,
        due_at=payload.due_at,
        evidence_references_json=json.dumps(payload.evidence_references),
    )
    session.add(action)
    incident.updated_at = _now()
    session.flush()
    session.add(
        _history(
            incident.id,
            "follow_up_action_added",
            actor,
            {"action_id": action.id, "status": action.status, "assignee": action.assignee},
        )
    )
    session.commit()
    session.refresh(incident)
    return _detail(session, incident)


def update_follow_up_action(
    session: Session,
    *,
    reference_id: str,
    action_id: int,
    payload: RecallFollowUpActionUpdate,
    actor: User,
    organization_id: int | None = None,
) -> RecallIncidentDetail:
    incident = _load_incident(session, reference_id, organization_id)
    action = session.scalar(
        select(RecallFollowUpAction).where(
            RecallFollowUpAction.id == action_id,
            RecallFollowUpAction.incident_id == incident.id,
        )
    )
    if action is None:
        raise RecallActionMissing("The follow-up action was not found for this incident")

    provided = payload.model_fields_set
    if "description" in provided and payload.description is not None:
        action.description = payload.description.strip()
    if "assignee" in provided:
        action.assignee = payload.assignee.strip() if payload.assignee else None
    if "due_at" in provided:
        action.due_at = payload.due_at
    if "completion_notes" in provided:
        action.completion_notes = payload.completion_notes.strip() if payload.completion_notes else None
    if "evidence_references" in provided and payload.evidence_references is not None:
        action.evidence_references_json = json.dumps(payload.evidence_references)
    if "status" in provided and payload.status is not None:
        if action.status != "completed" and payload.status == "completed":
            action.completed_at = _now()
        elif action.status == "completed" and payload.status != "completed":
            action.completed_at = None
        action.status = payload.status

    action.updated_at = _now()
    incident.updated_at = action.updated_at
    session.add(
        _history(
            incident.id,
            "follow_up_action_updated",
            actor,
            {"action_id": action.id, "status": action.status, "assignee": action.assignee},
        )
    )
    session.commit()
    session.refresh(incident)
    return _detail(session, incident)
