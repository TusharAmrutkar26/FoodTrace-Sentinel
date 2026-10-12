from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.auth import get_current_user, organization_scope, require_csrf, require_org_access, require_roles
from app.models.batch import Batch
from app.models.user import User
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

router = APIRouter(dependencies=[Depends(get_current_user)])
DbSession = Annotated[Session, Depends(get_db)]
BatchCodePath = Annotated[str, Path(min_length=1, max_length=64)]
PageLimit = Annotated[int, Query(ge=1, le=100)]
PageOffset = Annotated[int, Query(ge=0, le=10000)]
SearchText = Annotated[str, Query(min_length=1, max_length=120, pattern=r".*\S.*")]


@router.post("", response_model=BatchRead, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_csrf), Depends(require_roles("platform_admin", "org_admin", "operator"))])
def create_batch(payload: BatchCreate, session: DbSession, actor: Annotated[User, Depends(get_current_user)]) -> Batch:
    if actor.role != "platform_admin" and payload.origin_organization_id != actor.organization_id:
        raise HTTPException(status_code=404, detail="The requested organization was not found")
    try:
        return create_batch_record(session, payload)
    except RelatedRecordMissing as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except DuplicateBatchCode as error:
        raise HTTPException(status_code=409, detail="Batch code already exists") from error


@router.get("", response_model=BatchPage)
def list_batches(
    session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
    q: SearchText | None = None,
    product_id: Annotated[int | None, Query(gt=0)] = None,
    origin_organization_id: Annotated[int | None, Query(gt=0)] = None,
    limit: PageLimit = 20,
    offset: PageOffset = 0,
) -> BatchPage:
    if actor.role != "platform_admin":
        if origin_organization_id is not None and origin_organization_id != actor.organization_id:
            raise HTTPException(status_code=404, detail="The requested organization was not found")
        origin_organization_id = actor.organization_id
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
def get_batch(batch_code: BatchCodePath, session: DbSession, actor: Annotated[User, Depends(get_current_user)]) -> Batch:
    batch = get_batch_record(session, batch_code)
    if batch is None:
        raise HTTPException(status_code=404, detail="Batch was not found")
    require_org_access(actor, batch.origin_organization_id)
    return batch


@router.patch("/{batch_code}", response_model=BatchRead, dependencies=[Depends(require_csrf), Depends(require_roles("platform_admin", "org_admin", "operator"))])
def update_batch(
    batch_code: BatchCodePath,
    payload: BatchUpdate,
    session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
) -> Batch:
    current = get_batch_record(session, batch_code)
    if current is not None:
        require_org_access(actor, current.origin_organization_id)
    if actor.role != "platform_admin" and payload.origin_organization_id is not None and payload.origin_organization_id != actor.organization_id:
        raise HTTPException(status_code=404, detail="The requested organization was not found")
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
