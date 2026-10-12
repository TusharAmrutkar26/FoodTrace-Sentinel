from datetime import date, datetime
from typing import Literal

from pydantic import Field

from app.schemas.batch_event import EventType
from app.schemas.batch_genealogy import RelationshipType
from app.schemas.common import APIModel


class ReportPeriod(APIModel):
    start_date: date
    end_date: date
    timezone: Literal["UTC"] = "UTC"


class EventTypeCount(APIModel):
    event_type: EventType
    count: int = Field(ge=0)


class GenealogyTypeCount(APIModel):
    relationship_type: RelationshipType
    count: int = Field(ge=0)


class UnavailableMetric(APIModel):
    available: Literal[False] = False
    value: None = None
    unit: None = None
    reason: str


class SupplyChainReport(APIModel):
    period: ReportPeriod
    generated_at: datetime
    has_activity: bool
    batches_created: int = Field(ge=0)
    batches_with_event_activity: int = Field(ge=0)
    event_counts: list[EventTypeCount]
    genealogy_counts: list[GenealogyTypeCount]
    quantity_metrics: UnavailableMetric
    trace_trust_findings: UnavailableMetric
    definitions: list[str]
    warnings: list[str]
