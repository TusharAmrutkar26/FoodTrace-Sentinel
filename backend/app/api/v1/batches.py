from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.batch import Batch
from app.schemas.batch import BatchCreate, BatchPage, BatchRead, BatchUpdate
from app.services.batch_genealogy import GenealogyBatchUpdateConflict
from app.services.batches import (
    DuplicateBatchCode,
    RelatedRecordMissing,
    create_batch as create_batch_record,
    get_batch as get_batch_record,
    list_batches as list_batch_records,
    update_batch as update_batch_record,
)

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]
BatchCodePath = Annotated[str, Path(min_length=1, max_length=64)]
PageLimit = Annotated[int, Query(ge=1, le=100)]
PageOffset = Annotated[int, Query(ge=0, le=10000)]
SearchText = Annotated[str, Query(min_length=1, max_length=120, pattern=r".*\S.*")]


@router.post("", response_model=BatchRead, status_code=status.HTTP_201_CREATED)
def create_batch(payload: BatchCreate, session: DbSession) -> Batch:
    try:
        return create_batch_record(session, payload)
    except RelatedRecordMissing as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except DuplicateBatchCode as error:
        raise HTTPException(status_code=409, detail="Batch code already exists") from error


@router.get("", response_model=BatchPage)
def list_batches(
    session: DbSession,
    q: SearchText | None = None,
    product_id: Annotated[int | None, Query(gt=0)] = None,
    origin_organization_id: Annotated[int | None, Query(gt=0)] = None,
    limit: PageLimit = 20,
    offset: PageOffset = 0,
) -> BatchPage:
    items, total = list_batch_records(
        session,
        q=q,
        product_id=product_id,
        origin_organization_id=origin_organization_id,
        limit=limit,
        offset=offset,
    )
    return BatchPage(items=items, total=total, limit=limit, offset=offset)


@router.get("/{batch_code}", response_model=BatchRead)
def get_batch(batch_code: BatchCodePath, session: DbSession) -> Batch:
    batch = get_batch_record(session, batch_code)
    if batch is None:
        raise HTTPException(status_code=404, detail="Batch was not found")
    return batch


@router.patch("/{batch_code}", response_model=BatchRead)
def update_batch(
    batch_code: BatchCodePath,
    payload: BatchUpdate,
    session: DbSession,
) -> Batch:
    try:
        batch = update_batch_record(session, batch_code, payload)
    except RelatedRecordMissing as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except GenealogyBatchUpdateConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Batch update conflicts with stored data") from error
    if batch is None:
        raise HTTPException(status_code=404, detail="Batch was not found")
    return batch
