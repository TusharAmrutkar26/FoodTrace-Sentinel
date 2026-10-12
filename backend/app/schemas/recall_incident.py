from datetime import datetime
from typing import Any, Literal

from pydantic import Field, StringConstraints, field_validator, model_validator
from typing import Annotated

from app.schemas.common import APIModel, as_utc
from app.schemas.recall import RecallSimulationResponse

IncidentReference = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=24)]
BatchCode = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
ReasonText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
ShortName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
ActionText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
OptionalNotes = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
OptionalText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)]

IncidentStatus = Literal[
    "pending_review", "requires_investigation", "approved_for_next_step", "rejected"
]
ReviewDecision = Literal["requires_investigation", "approved_for_next_step", "rejected"]
ActionStatus = Literal["open", "in_progress", "completed", "cancelled"]
HistoryEventType = Literal[
    "incident_created", "candidate_scope_captured", "review_recorded",
    "follow_up_action_added", "follow_up_action_updated",
]


class RecallIncidentCreate(APIModel):
    root_batch_code: BatchCode
    reason: ReasonText
    created_by: ShortName | None = None


class RecallIncidentSummary(APIModel):
    reference_id: str
    root_batch_code: str
    reason: str
    status: IncidentStatus
    created_by: str | None
    created_by_verified: bool = False
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def normalize_times(cls, value: datetime) -> datetime:
        return as_utc(value)


class RecallIncidentPage(APIModel):
    items: list[RecallIncidentSummary]
    total: int
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0, le=10_000)


class RecallSnapshotCreate(APIModel):
    max_depth: int = Field(default=25, ge=1, le=50)


class RecallSnapshotRead(APIModel):
    id: int
    captured_at: datetime
    simulated_at: datetime
    max_depth: int
    simulation: RecallSimulationResponse

    @field_validator("captured_at", "simulated_at")
    @classmethod
    def normalize_times(cls, value: datetime) -> datetime:
        return as_utc(value)


class RecallReviewCreate(APIModel):
    decision: ReviewDecision
    notes: OptionalNotes | None = None
    reviewer_name: ShortName | None = None


class RecallReviewRead(APIModel):
    id: int
    decision: ReviewDecision
    notes: str | None
    reviewer_name: str | None
    reviewer_identity_verified: bool = False
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def normalize_created_at(cls, value: datetime) -> datetime:
        return as_utc(value)


class RecallFollowUpActionCreate(APIModel):
    description: ActionText
    assignee: ShortName | None = None
    due_at: datetime | None = None
    evidence_references: list[ShortName] = Field(default_factory=list, max_length=50)

    @field_validator("due_at")
    @classmethod
    def normalize_due_at(cls, value: datetime | None) -> datetime | None:
        return as_utc(value) if value else None


class RecallFollowUpActionUpdate(APIModel):
    description: ActionText | None = None
    status: ActionStatus | None = None
    assignee: ShortName | None = None
    due_at: datetime | None = None
    completion_notes: OptionalText | None = None
    evidence_references: list[ShortName] | None = Field(default=None, max_length=50)

    @field_validator("due_at")
    @classmethod
    def normalize_due_at(cls, value: datetime | None) -> datetime | None:
        return as_utc(value) if value else None

    @model_validator(mode="after")
    def validate_not_empty(self) -> "RecallFollowUpActionUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one action field must be provided")
        return self


class RecallFollowUpActionRead(APIModel):
    id: int
    description: str
    status: ActionStatus
    assignee: str | None
    due_at: datetime | None
    completion_notes: str | None
    evidence_references: list[str]
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None

    @field_validator("due_at", "created_at", "updated_at", "completed_at")
    @classmethod
    def normalize_times(cls, value: datetime | None) -> datetime | None:
        return as_utc(value) if value else None


class RecallIncidentHistoryRead(APIModel):
    id: int
    event_type: HistoryEventType
    actor_name: str | None
    actor_identity_verified: bool = False
    details: dict[str, Any]
    recorded_at: datetime

    @field_validator("recorded_at")
    @classmethod
    def normalize_recorded_at(cls, value: datetime) -> datetime:
        return as_utc(value)


class RecallIncidentDetail(RecallIncidentSummary):
    snapshots: list[RecallSnapshotRead]
    reviews: list[RecallReviewRead]
    actions: list[RecallFollowUpActionRead]
    history: list[RecallIncidentHistoryRead]
