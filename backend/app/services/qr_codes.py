import ipaddress
from urllib.parse import urlsplit

import qrcode
from qrcode.image.svg import SvgPathImage
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import PUBLIC_TRACE_BASE_URL
from app.models.batch import Batch
from app.models.batch_trace_identity import BatchTraceIdentity


def build_trace_url(trace_id: str, base_url: str | None = None) -> str:
    """Build a canonical public URL from an opaque identity and frontend origin."""
    configured_base = PUBLIC_TRACE_BASE_URL if base_url is None else base_url
    if not configured_base or not configured_base.strip():
        raise ValueError(
            "PUBLIC_TRACE_BASE_URL is not configured. Set it in backend/.env to "
            "the frontend origin reachable by the QR scanner, for example "
            "http://<your-laptop-lan-ip>:5176 after replacing the placeholder."
        )

    base = configured_base.strip().rstrip("/")
    try:
        parsed = urlsplit(base)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as error:
        raise ValueError(
            "PUBLIC_TRACE_BASE_URL must be a valid HTTP(S) frontend origin with a valid host and port."
        ) from error

    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or "?" in base
        or "#" in base
        or (port is not None and not 1 <= port <= 65535)
    ):
        raise ValueError(
            "PUBLIC_TRACE_BASE_URL must be an HTTP(S) origin without a path, "
            "credentials, query, or fragment."
        )

    try:
        ip_address = ipaddress.ip_address(hostname)
    except ValueError:
        ip_address = None
    if hostname.casefold() == "localhost" or hostname.casefold().endswith(".localhost"):
        raise ValueError(
            "PUBLIC_TRACE_BASE_URL must use an address reachable by the phone; "
            "localhost and loopback addresses are not reachable from another device."
        )
    if ip_address is not None and (ip_address.is_loopback or ip_address.is_unspecified):
        raise ValueError(
            "PUBLIC_TRACE_BASE_URL must use an address reachable by the phone; "
            "loopback and wildcard addresses are not reachable from another device."
        )
    return f"{base}/trace/{trace_id}"


def get_trace_identity(
    session: Session, batch_code: str
) -> BatchTraceIdentity | None:
    return session.scalar(
        select(BatchTraceIdentity)
        .join(Batch, Batch.id == BatchTraceIdentity.batch_id)
        .where(Batch.batch_code == batch_code.strip().upper())
    )


def generate_trace_qr_svg(trace_url: str) -> str:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=4,
    )
    qr.add_data(trace_url)
    qr.make(fit=True)
    image = qr.make_image(image_factory=SvgPathImage)
    return image.to_string(encoding="unicode")
