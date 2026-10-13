from decimal import Decimal, InvalidOperation
import ipaddress
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv
from sqlalchemy.engine import make_url

BACKEND_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_ROOT / ".env")

APP_NAME = os.getenv("APP_NAME", "FoodTrace Sentinel API")
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
if APP_ENV not in {"development", "test", "production"}:
    raise ValueError("APP_ENV must be development, test, or production")


def resolve_database_url(
    value: str,
    *,
    backend_root: Path = BACKEND_ROOT,
    production: bool = False,
) -> str:
    """Anchor relative SQLite paths to the backend, never the process CWD."""
    try:
        url = make_url(value)
    except Exception as error:
        raise ValueError("DATABASE_URL must be a valid SQLAlchemy URL") from error

    if url.get_backend_name() != "sqlite":
        return value
    if not url.database or url.database == ":memory:":
        if production:
            raise ValueError("Production SQLite DATABASE_URL must use an absolute path on persistent storage")
        return value
    if url.database.startswith("file:"):
        if production:
            raise ValueError("Production SQLite DATABASE_URL must use an absolute path on persistent storage")
        return value

    database_path = Path(url.database)
    if production and not database_path.is_absolute():
        raise ValueError(
            "Production SQLite DATABASE_URL must use an absolute path on persistent storage"
        )
    if not database_path.is_absolute():
        database_path = backend_root / database_path
    return url.set(database=str(database_path.resolve())).render_as_string(hide_password=False)


DATABASE_URL = resolve_database_url(
    os.getenv("DATABASE_URL", f"sqlite:///{(BACKEND_ROOT / 'foodtrace.db').as_posix()}"),
    production=APP_ENV == "production",
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
def parse_public_trace_base_url(value: str | None, *, production: bool = False) -> str | None:
    """Validate the public origin used in batch QR codes."""
    normalized = value.strip().rstrip("/") if value and value.strip() else None
    if normalized is None:
        if production:
            raise ValueError("Production requires PUBLIC_TRACE_BASE_URL to be configured")
        return None

    try:
        parsed = urlsplit(normalized)
        hostname = parsed.hostname
        parsed.port  # Validate the port syntax and range.
    except ValueError as error:
        raise ValueError("PUBLIC_TRACE_BASE_URL must be a valid HTTP(S) frontend origin") from error

    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or "?" in normalized
        or "#" in normalized
    ):
        raise ValueError("PUBLIC_TRACE_BASE_URL must be an HTTP(S) origin without credentials, path, query, or fragment")

    host = hostname.casefold()
    if host == "localhost" or host.endswith(".localhost"):
        raise ValueError("PUBLIC_TRACE_BASE_URL must use a publicly reachable host")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address is not None and (address.is_loopback or address.is_unspecified):
        raise ValueError("PUBLIC_TRACE_BASE_URL must not use a loopback or wildcard address")
    if production:
        if parsed.scheme != "https":
            raise ValueError("Production PUBLIC_TRACE_BASE_URL must use HTTPS")
        if address is not None or "." not in host or host.endswith((".example", ".invalid", ".test")):
            raise ValueError("Production PUBLIC_TRACE_BASE_URL must use a stable HTTPS domain name")
    return normalized


PUBLIC_TRACE_BASE_URL = parse_public_trace_base_url(
    os.getenv("PUBLIC_TRACE_BASE_URL"), production=APP_ENV == "production"
)

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
