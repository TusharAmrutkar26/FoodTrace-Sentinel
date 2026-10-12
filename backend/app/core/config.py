from decimal import Decimal, InvalidOperation
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_ROOT / ".env")

APP_NAME = os.getenv("APP_NAME", "FoodTrace Sentinel API")
APP_ENV = os.getenv("APP_ENV", "development")
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{(BACKEND_ROOT / 'foodtrace.db').as_posix()}",
)
def parse_frontend_origins(value: str, *, production: bool = False) -> list[str]:
    origins = [origin.strip() for origin in value.split(",") if origin.strip()]
    if not origins or any("*" in origin for origin in origins):
        raise ValueError("FRONTEND_ORIGINS must list explicit browser origins; wildcards are not allowed")
    for origin in origins:
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("Each FRONTEND_ORIGINS value must be an explicit http(s) origin without a path")
        if production and parsed.scheme != "https":
            raise ValueError("Production FRONTEND_ORIGINS must use HTTPS")
    return list(dict.fromkeys(origins))


FRONTEND_ORIGINS = parse_frontend_origins(
    os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"),
    production=APP_ENV.lower() == "production",
)
PUBLIC_TRACE_BASE_URL = os.getenv("PUBLIC_TRACE_BASE_URL", "").strip().rstrip("/") or None

AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "foodtrace_session").strip()
AUTH_SESSION_TTL_HOURS = int(os.getenv("AUTH_SESSION_TTL_HOURS", "12"))
AUTH_INVITATION_TTL_HOURS = int(os.getenv("AUTH_INVITATION_TTL_HOURS", "72"))


def parse_auth_cookie_secure(value: str | None, *, production: bool = False) -> bool:
    if value is None:
        return production
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        if production:
            raise ValueError("AUTH_COOKIE_SECURE must be true in production")
        return False
    raise ValueError("AUTH_COOKIE_SECURE must be a boolean value")


AUTH_COOKIE_SECURE = parse_auth_cookie_secure(
    os.getenv("AUTH_COOKIE_SECURE"), production=APP_ENV.lower() == "production"
)
if (
    not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", AUTH_COOKIE_NAME)
    or AUTH_SESSION_TTL_HOURS < 1
    or AUTH_INVITATION_TTL_HOURS < 1
):
    raise ValueError("Authentication cookie name and expiry settings must be valid")


def _process_loss_threshold() -> Decimal:
    raw = os.getenv("TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT", "20").strip()
    if len(raw) > 32 or not re.fullmatch(r"\d+(?:\.\d+)?", raw):
        raise ValueError(
            "TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT must be a decimal from 0 to 100"
        )
    try:
        threshold = Decimal(raw)
    except InvalidOperation as error:
        raise ValueError(
            "TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT must be a decimal from 0 to 100"
        ) from error
    if not threshold.is_finite() or threshold < 0 or threshold > 100:
        raise ValueError(
            "TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT must be a decimal from 0 to 100"
        )
    return threshold


TRACE_TRUST_PROCESS_LOSS_THRESHOLD_PERCENT = _process_loss_threshold()
