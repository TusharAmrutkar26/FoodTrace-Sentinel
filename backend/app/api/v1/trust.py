from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.config import TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT
from app.core.auth import get_current_user, organization_scope
from app.db.session import get_db
from app.schemas.trust import (
    FindingCheckType,
    FindingSeverity,
    FindingStatus,
    TrustFindingPage,
)
from app.models.user import User
from app.services.trace_trust import get_trust_findings

router = APIRouter(dependencies=[Depends(get_current_user)])
DbSession = Annotated[Session, Depends(get_db)]
PageLimit = Annotated[int, Query(ge=1, le=100)]
PageOffset = Annotated[int, Query(ge=0, le=10000)]
BatchCodeFilter = Annotated[str, Query(min_length=1, max_length=64, pattern=r".*\S.*")]


@router.get("/trust/findings", response_model=TrustFindingPage)
def read_trust_findings(
    session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
    severity: Annotated[FindingSeverity | None, Query()] = None,
    check_type: Annotated[FindingCheckType | None, Query()] = None,
    batch_code: BatchCodeFilter | None = None,
    status: Annotated[FindingStatus | None, Query()] = None,
    limit: PageLimit = 50,
    offset: PageOffset = 0,
) -> TrustFindingPage:
    return get_trust_findings(
        session,
        process_loss_threshold_percent=Decimal(
            TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT
        ),
        severity=severity,
        check_type=check_type,
        batch_code=batch_code,
        status=status,
        organization_id=organization_scope(actor),
        limit=limit,
        offset=offset,
    )
