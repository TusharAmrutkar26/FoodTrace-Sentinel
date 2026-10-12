from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.auth import get_current_user, organization_scope
from app.models.user import User
from app.schemas.reports import SupplyChainReport
from app.services.supply_chain_reports import (
    build_supply_chain_report,
    default_report_period,
)

router = APIRouter(dependencies=[Depends(get_current_user)])
DbSession = Annotated[Session, Depends(get_db)]


@router.get("/reports/supply-chain", response_model=SupplyChainReport)
def read_supply_chain_report(
    session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
    start_date: Annotated[date | None, Query()] = None,
    end_date: Annotated[date | None, Query()] = None,
) -> SupplyChainReport:
    if (start_date is None) != (end_date is None):
        raise HTTPException(
            status_code=422,
            detail="Provide both start_date and end_date, or omit both for the default completed UTC week.",
        )
    if start_date is None or end_date is None:
        start_date, end_date = default_report_period()
    if start_date > end_date:
        raise HTTPException(
            status_code=422,
            detail="start_date must be on or before end_date.",
        )
    if end_date == date.max:
        raise HTTPException(
            status_code=422,
            detail="end_date must be earlier than 9999-12-31.",
        )
    return build_supply_chain_report(
        session,
        start_date=start_date,
        end_date=end_date,
        organization_id=organization_scope(actor),
    )
