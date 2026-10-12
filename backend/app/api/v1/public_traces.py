from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.public_trace import PublicBatchTraceRead
from app.services.public_traces import get_public_batch_trace

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]
TraceIdPath = Annotated[str, Path(min_length=1, max_length=64)]


@router.get("/public-traces/{trace_id}", response_model=PublicBatchTraceRead)
def read_public_batch_trace(trace_id: TraceIdPath, session: DbSession):
    trace = get_public_batch_trace(session, trace_id)
    if trace is None:
        raise HTTPException(status_code=404, detail="Trace record was not found")
    return trace
