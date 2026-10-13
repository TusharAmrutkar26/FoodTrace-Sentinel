from pathlib import Path

import pytest
from sqlalchemy.engine import make_url

from app.core.config import parse_public_trace_base_url, resolve_database_url


def test_relative_sqlite_database_url_is_anchored_to_backend_root():
    backend_root = Path.cwd() / "_config_test_backend"
    database_url = resolve_database_url("sqlite:///./foodtrace.db", backend_root=backend_root)

    assert Path(make_url(database_url).database) == (backend_root / "foodtrace.db").resolve()


def test_production_sqlite_requires_absolute_persistent_path():
    backend_root = Path.cwd() / "_config_test_backend"
    with pytest.raises(ValueError, match="absolute path on persistent storage"):
        resolve_database_url(
            "sqlite:///./foodtrace.db",
            backend_root=backend_root,
            production=True,
        )
    with pytest.raises(ValueError, match="absolute path on persistent storage"):
        resolve_database_url("sqlite:///:memory:", backend_root=backend_root, production=True)
    with pytest.raises(ValueError, match="absolute path on persistent storage"):
        resolve_database_url("sqlite://", backend_root=backend_root, production=True)

    absolute_database = backend_root / "persistent" / "foodtrace.db"
    absolute_url = "sqlite:///" + absolute_database.as_posix()
    resolved = resolve_database_url(absolute_url, backend_root=backend_root, production=True)
    assert Path(make_url(resolved).database) == absolute_database.resolve()


def test_external_database_url_is_not_rewritten():
    database_url = "postgresql+psycopg://user:password@example.invalid/foodtrace"
    assert resolve_database_url(database_url) == database_url


def test_public_trace_origin_allows_local_http_and_production_https_domain():
    assert parse_public_trace_base_url("http://192.0.2.10:5176", production=False) == "http://192.0.2.10:5176"
    assert parse_public_trace_base_url("https://trace.example.com", production=True) == "https://trace.example.com"


@pytest.mark.parametrize(
    "value",
    [
        None,
        "http://trace.example.invalid",
        "https://192.0.2.10",
        "https://trace.example.invalid",
        "https://trace.example.invalid/path",
        "https://user:password@trace.example.invalid",
        "http://localhost:5176",
    ],
)
def test_production_public_trace_origin_rejects_missing_or_unsafe_values(value):
    with pytest.raises(ValueError):
        parse_public_trace_base_url(value, production=True)


def test_invalid_public_trace_origin_is_rejected_in_development_too():
    with pytest.raises(ValueError, match="origin"):
        parse_public_trace_base_url("https://trace.example.invalid/path", production=False)
