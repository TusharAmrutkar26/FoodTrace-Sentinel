from collections.abc import Generator

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import DATABASE_URL


def build_engine(database_url: str = DATABASE_URL, **options: object) -> Engine:
    """Create an engine and enable SQLite foreign keys on every connection."""
    connect_args = dict(options.pop("connect_args", {}))
    if database_url.startswith("sqlite"):
        connect_args.setdefault("check_same_thread", False)
        connect_args.setdefault("timeout", 30)

    engine = create_engine(
        database_url,
        connect_args=connect_args,
        pool_pre_ping=True,
        **options,
    )

    if database_url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def enable_sqlite_foreign_keys(dbapi_connection: object, _record: object) -> None:
            cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
            try:
                cursor.execute("PRAGMA foreign_keys=ON")
            finally:
                cursor.close()

    return engine


engine = build_engine()
SessionLocal = sessionmaker(
    bind=engine,
    class_=Session,
    autoflush=False,
    expire_on_commit=False,
)


def get_db() -> Generator[Session, None, None]:
    """Yield one request-scoped session and always close it safely."""
    with SessionLocal() as session:
        try:
            yield session
        except Exception:
            session.rollback()
            raise
