from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.auth import get_current_user, require_org_access
from app.models.batch import Batch
from app.models.user import User
from app.schemas.public_trace import BatchQrIdentityRead
from app.services.qr_codes import (
    build_trace_url,
    generate_trace_qr_svg,
    get_trace_identity,
)

router = APIRouter(dependencies=[Depends(get_current_user)])
DbSession = Annotated[Session, Depends(get_db)]
BatchCodePath = Annotated[str, Path(min_length=1, max_length=64)]


def _configured_trace_url(trace_id: str) -> str:
    try:
        return build_trace_url(trace_id)
    except ValueError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.get("/batches/{batch_code}/qr", response_model=BatchQrIdentityRead)
def read_batch_qr_identity(
    batch_code: BatchCodePath, session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
) -> BatchQrIdentityRead:
    batch = session.scalar(select(Batch).where(Batch.batch_code == batch_code.strip().upper()))
    if batch is not None:
        require_org_access(actor, batch.origin_organization_id)
    identity = get_trace_identity(session, batch_code)
    if identity is None:
        raise HTTPException(status_code=404, detail="Batch was not found")
    return BatchQrIdentityRead(
        trace_id=identity.trace_id,
        trace_url=_configured_trace_url(identity.trace_id),
    )


@router.get("/batches/{batch_code}/qr.svg")
def read_batch_qr_svg(
    batch_code: BatchCodePath, session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
) -> Response:
    batch = session.scalar(select(Batch).where(Batch.batch_code == batch_code.strip().upper()))
    if batch is not None:
        require_org_access(actor, batch.origin_organization_id)
    identity = get_trace_identity(session, batch_code)
    if identity is None:
        raise HTTPException(status_code=404, detail="Batch was not found")
    trace_url = _configured_trace_url(identity.trace_id)
    return Response(
        content=generate_trace_qr_svg(trace_url),
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=300"},
    )
