from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, organization_scope, require_csrf, require_org_access, require_roles
from app.db.session import get_db
from app.models.batch import Batch
from app.models.batch_genealogy import BatchGenealogy
from app.models.user import User
from app.schemas.batch_genealogy import (
    GenealogyCreate,
    GenealogyGraphRead,
    GenealogyRead,
    GenealogyTraceRead,
    TraceDirection,
)
from app.services.batch_genealogy import (
    GenealogyBatchMissing,
    GenealogyConflict,
    GenealogyValidationError,
    create_relationship,
    get_genealogy,
    trace_genealogy,
)

router = APIRouter(dependencies=[Depends(get_current_user)])
DbSession = Annotated[Session, Depends(get_db)]
BatchCodePath = Annotated[str, Path(min_length=1, max_length=64)]


@router.post(
    "/genealogy",
    response_model=GenealogyRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_csrf), Depends(require_roles("platform_admin", "org_admin", "operator"))],
)
def create_batch_relationship(
    payload: GenealogyCreate,
    session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
) -> GenealogyRead:
    if actor.role != "platform_admin":
        parent = session.get(Batch, payload.parent_batch_id)
        child = session.get(Batch, payload.child_batch_id)
        if parent is not None:
            require_org_access(actor, parent.origin_organization_id)
        if child is not None:
            require_org_access(actor, child.origin_organization_id)
    try:
        relationship: BatchGenealogy = create_relationship(session, payload)
    except GenealogyBatchMissing as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except GenealogyValidationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except GenealogyConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return GenealogyRead.from_relationship(relationship)


@router.get(
    "/batches/{batch_code}/genealogy",
    response_model=GenealogyGraphRead,
)
def read_batch_genealogy(
    batch_code: BatchCodePath,
    session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
) -> GenealogyGraphRead:
    batch = session.scalar(select(Batch).where(Batch.batch_code == batch_code.strip().upper()))
    if batch is not None:
        require_org_access(actor, batch.origin_organization_id)
    result = get_genealogy(session, batch_code, organization_id=organization_scope(actor))
    if result is None:
        raise HTTPException(status_code=404, detail="Batch was not found")
    return result


@router.get(
    "/batches/{batch_code}/trace",
    response_model=GenealogyTraceRead,
)
def trace_batch_genealogy(
    batch_code: BatchCodePath,
    session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
    direction: Annotated[TraceDirection, Query()],
) -> GenealogyTraceRead:
    batch = session.scalar(select(Batch).where(Batch.batch_code == batch_code.strip().upper()))
    if batch is not None:
        require_org_access(actor, batch.origin_organization_id)
    result = trace_genealogy(session, batch_code, direction, organization_id=organization_scope(actor))
    if result is None:
        raise HTTPException(status_code=404, detail="Batch was not found")
    return result
