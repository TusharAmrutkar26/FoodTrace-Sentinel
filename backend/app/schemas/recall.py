from datetime import datetime
from typing import Annotated

from pydantic import Field, StringConstraints, field_validator

from app.schemas.common import APIModel, as_utc
from app.schemas.trust import TrustFinding

BatchCode = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=64),
]


class RecallSimulationRequest(APIModel):
    root_batch_code: BatchCode
    max_depth: int = Field(default=25, ge=1, le=50)


class RecallEventEvidence(APIModel):
    event_type: str
    occurred_at: datetime
    organization_name: str | None
    participant_type: str | None
    location: str | None
    notes: str | None
    recorded_at: datetime

    @field_validator("occurred_at", "recorded_at")
    @classmethod
    def normalize_timestamps(cls, value: datetime) -> datetime:
        return as_utc(value)


class RecallBatchRecord(APIModel):
    batch_code: str
    product_name: str | None
    origin_organization: str | None
    participant_type: str | None
    origin_location: str | None
    quantity: str | None
    unit: str | None
    created_at: datetime
    events: list[RecallEventEvidence]

    @field_validator("created_at")
    @classmethod
    def normalize_created_at(cls, value: datetime) -> datetime:
        return as_utc(value)


class RecallPathEntry(APIModel):
    batch_code: str | None
    depth: int = Field(ge=1)
    # Paths begin with the selected root and follow the direction being traversed.
    path: list[str | None]


class RecallRelationshipEvidence(APIModel):
    parent_batch_code: str | None
    child_batch_code: str | None
    relationship_type: str
    source_quantity: str | None
    source_unit: str | None
    recorded_at: datetime
    structurally_valid: bool
    validation_issues: list[str]

    @field_validator("recorded_at")
    @classmethod
    def normalize_recorded_at(cls, value: datetime) -> datetime:
        return as_utc(value)


class RecallCompleteness(APIModel):
    max_depth: int = Field(ge=1, le=50)
    upstream_depth_limit_reached: bool
    downstream_depth_limit_reached: bool
    batch_limit_reached: bool
    relationship_limit_reached: bool
    event_history_truncated: bool
    trace_trust_findings_truncated: bool
    cycle_detected: bool
    missing_batch_references: bool
    invalid_relationships: bool
    traversal_complete: bool


class RecallSimulationResponse(APIModel):
    simulated_at: datetime
    root_batch: RecallBatchRecord
    related_batches: list[RecallBatchRecord]
    upstream: list[RecallPathEntry]
    downstream: list[RecallPathEntry]
    relationships: list[RecallRelationshipEvidence]
    trace_trust_findings: list[TrustFinding]
    completeness: RecallCompleteness
    warnings: list[str]
    human_review_warning: str
    recommended_next_action: str

    @field_validator("simulated_at")
    @classmethod
    def normalize_simulated_at(cls, value: datetime) -> datetime:
        return as_utc(value)
