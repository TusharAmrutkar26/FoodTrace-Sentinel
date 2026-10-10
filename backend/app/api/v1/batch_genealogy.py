from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.batch_genealogy import BatchGenealogy
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

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]
BatchCodePath = Annotated[str, Path(min_length=1, max_length=64)]


@router.post(
    "/genealogy",
    response_model=GenealogyRead,
    status_code=status.HTTP_201_CREATED,
)
def create_batch_relationship(
    payload: GenealogyCreate,
    session: DbSession,
) -> GenealogyRead:
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
) -> GenealogyGraphRead:
    result = get_genealogy(session, batch_code)
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
    direction: Annotated[TraceDirection, Query()],
) -> GenealogyTraceRead:
    result = trace_genealogy(session, batch_code, direction)
    if result is None:
        raise HTTPException(status_code=404, detail="Batch was not found")
    return result
