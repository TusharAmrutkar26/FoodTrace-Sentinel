import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, field_validator

from app.schemas.common import APIModel, as_utc

UserRole = Literal["platform_admin", "org_admin", "operator", "reviewer", "viewer"]
InviteRole = Literal["org_admin", "operator", "reviewer", "viewer"]
EmailInput = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=254)]
PasswordInput = Annotated[str, StringConstraints(min_length=12, max_length=128)]


def normalize_email(value: str) -> str:
    normalized = value.strip().lower()
    if len(normalized) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized):
        raise ValueError("Enter a valid email address")
    return normalized


class LoginInput(APIModel):
    email: EmailInput
    password: PasswordInput

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return normalize_email(value)


class RegistrationInput(APIModel):
    invitation_token: Annotated[str, StringConstraints(strip_whitespace=True, min_length=32, max_length=128)]
    password: PasswordInput


class InvitationCreate(APIModel):
    email: EmailInput
    role: InviteRole
    organization_id: int | None = Field(default=None, gt=0)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return normalize_email(value)


class AuthOrganization(APIModel):
    id: int
    name: str


class AuthUserRead(APIModel):
    email: str
    role: UserRole
    organization: AuthOrganization | None


class AuthSessionRead(APIModel):
    user: AuthUserRead
    csrf_token: str


class InvitationRead(APIModel):
    email: str
    role: InviteRole
    organization: AuthOrganization
    invitation_token: str
    expires_at: datetime

    @field_validator("expires_at")
    @classmethod
    def normalize_expiry(cls, value: datetime) -> datetime:
        return as_utc(value)
