from logging.config import fileConfig
from pathlib import Path
import sys

from alembic import context
from sqlalchemy.pool import NullPool

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import DATABASE_URL  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import build_engine  # noqa: E402
import app.models  # noqa: E402,F401  (register model metadata)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", DATABASE_URL.replace("%", "%%"))
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=DATABASE_URL.startswith("sqlite"),
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    sqlite = connection.dialect.name == "sqlite"
    succeeded = False
    if sqlite:
        # SQLite cannot toggle foreign_keys inside a transaction. Commit any
        # caller-side migration setup, disable checks only during migrations,
        # then verify all references and restore enforcement.
        connection.commit()
        preexisting_violations = connection.exec_driver_sql("PRAGMA foreign_key_check").all()
        if preexisting_violations:
            raise RuntimeError(
                f"SQLite database already has invalid foreign-key references: {preexisting_violations!r}"
            )
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        if connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() != 0:
            raise RuntimeError("Could not disable SQLite foreign keys for the schema migration")
    try:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=sqlite,
        )
        with context.begin_transaction():
            context.run_migrations()
        if sqlite:
            connection.commit()
            violations = connection.exec_driver_sql("PRAGMA foreign_key_check").all()
            if violations:
                raise RuntimeError(f"SQLite migration left invalid foreign-key references: {violations!r}")
        succeeded = True
    finally:
        if sqlite:
            if succeeded:
                connection.commit()
            else:
                connection.rollback()
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")


def run_migrations_online() -> None:
    supplied_connection = config.attributes.get("connection")
    if supplied_connection is not None:
        do_run_migrations(supplied_connection)
        return

    connectable = build_engine(DATABASE_URL, poolclass=NullPool)
    try:
        with connectable.connect() as connection:
            do_run_migrations(connection)
    finally:
        connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
