from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, organization_scope, require_csrf, require_roles
from app.db.session import get_db
from app.models.user import User
from app.schemas.recall_incident import (
    RecallFollowUpActionCreate,
    RecallFollowUpActionUpdate,
    RecallIncidentCreate,
    RecallIncidentDetail,
    RecallIncidentHistoryRead,
    RecallIncidentPage,
    RecallReviewCreate,
    RecallSnapshotCreate,
    RecallSnapshotRead,
)
from app.services.recall_incidents import (
    RecallActionMissing,
    RecallIncidentBatchMissing,
    RecallIncidentMissing,
    add_follow_up_action,
    capture_snapshot,
    create_incident,
    get_incident,
    get_incident_history,
    list_incidents,
    record_review,
    update_follow_up_action,
)

router = APIRouter(dependencies=[Depends(get_current_user)])
DbSession = Annotated[Session, Depends(get_db)]
IncidentStatusFilter = Literal[
    "pending_review", "requires_investigation", "approved_for_next_step", "rejected"
]


@router.post("/recall-incidents", response_model=RecallIncidentDetail, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_csrf), Depends(require_roles("platform_admin", "org_admin", "operator"))])
def create_recall_incident(payload: RecallIncidentCreate, session: DbSession, actor: Annotated[User, Depends(get_current_user)]) -> RecallIncidentDetail:
    try:
        return create_incident(
            session,
            root_batch_code=payload.root_batch_code,
            reason=payload.reason,
            actor=actor,
            organization_id=organization_scope(actor),
        )
    except RecallIncidentBatchMissing as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/recall-incidents", response_model=RecallIncidentPage)
def read_recall_incidents(
    session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10_000),
    status_filter: IncidentStatusFilter | None = Query(default=None, alias="status"),
) -> RecallIncidentPage:
    return list_incidents(
        session, limit=limit, offset=offset, status_filter=status_filter,
        organization_id=organization_scope(actor),
    )


@router.get("/recall-incidents/{reference_id}", response_model=RecallIncidentDetail)
def read_recall_incident(reference_id: str, session: DbSession, actor: Annotated[User, Depends(get_current_user)]) -> RecallIncidentDetail:
    try:
        return get_incident(session, reference_id, organization_scope(actor))
    except RecallIncidentMissing as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get(
    "/recall-incidents/{reference_id}/history",
    response_model=list[RecallIncidentHistoryRead],
)
def read_recall_incident_history(
    reference_id: str, session: DbSession, actor: Annotated[User, Depends(get_current_user)]
) -> list[RecallIncidentHistoryRead]:
    try:
        return get_incident_history(session, reference_id, organization_scope(actor))
    except RecallIncidentMissing as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post(
    "/recall-incidents/{reference_id}/snapshots",
    response_model=RecallSnapshotRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_csrf), Depends(require_roles("platform_admin", "org_admin", "operator"))],
)
def create_candidate_snapshot(
    reference_id: str, payload: RecallSnapshotCreate, session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
) -> RecallSnapshotRead:
    try:
        return capture_snapshot(
            session, reference_id=reference_id, max_depth=payload.max_depth,
            actor=actor, organization_id=organization_scope(actor),
        )
    except RecallIncidentMissing as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post(
    "/recall-incidents/{reference_id}/reviews",
    response_model=RecallIncidentDetail,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_csrf), Depends(require_roles("platform_admin", "org_admin", "reviewer"))],
)
def create_recall_review(
    reference_id: str, payload: RecallReviewCreate, session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
) -> RecallIncidentDetail:
    try:
        return record_review(session, reference_id=reference_id, payload=payload,
                             actor=actor, organization_id=organization_scope(actor))
    except RecallIncidentMissing as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post(
    "/recall-incidents/{reference_id}/actions",
    response_model=RecallIncidentDetail,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_csrf), Depends(require_roles("platform_admin", "org_admin", "operator"))],
)
def create_follow_up_action(
    reference_id: str, payload: RecallFollowUpActionCreate, session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
) -> RecallIncidentDetail:
    try:
        return add_follow_up_action(session, reference_id=reference_id, payload=payload,
                                    actor=actor, organization_id=organization_scope(actor))
    except RecallIncidentMissing as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.patch(
    "/recall-incidents/{reference_id}/actions/{action_id}",
    response_model=RecallIncidentDetail,
    dependencies=[Depends(require_csrf), Depends(require_roles("platform_admin", "org_admin", "operator"))],
)
def patch_follow_up_action(
    reference_id: str,
    action_id: int,
    payload: RecallFollowUpActionUpdate,
    session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
) -> RecallIncidentDetail:
    try:
        return update_follow_up_action(
            session,
            reference_id=reference_id,
            action_id=action_id,
            payload=payload,
            actor=actor,
            organization_id=organization_scope(actor),
        )
    except RecallIncidentMissing as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except RecallActionMissing as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
