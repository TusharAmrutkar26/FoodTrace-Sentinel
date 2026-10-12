from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, organization_scope, require_org_access
from app.core.config import TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT
from app.db.session import get_db
from app.models.batch import Batch
from app.models.user import User
from app.schemas.recall import RecallSimulationRequest, RecallSimulationResponse
from app.services.recalls import RecallRootBatchMissing, simulate_recall

router = APIRouter(dependencies=[Depends(get_current_user)])
DbSession = Annotated[Session, Depends(get_db)]


@router.post(
    "/recalls/simulate",
    response_model=RecallSimulationResponse,
    status_code=status.HTTP_200_OK,
)
def run_recall_simulation(
    payload: RecallSimulationRequest,
    session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
) -> RecallSimulationResponse:
    root = session.scalar(
        select(Batch).where(Batch.batch_code == payload.root_batch_code.strip().upper())
    )
    if root is not None:
        require_org_access(actor, root.origin_organization_id)
    try:
        return simulate_recall(
            session,
            root_batch_code=payload.root_batch_code,
            max_depth=payload.max_depth,
            process_loss_threshold_percent=TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT,
            organization_id=organization_scope(actor),
        )
    except RecallRootBatchMissing as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
