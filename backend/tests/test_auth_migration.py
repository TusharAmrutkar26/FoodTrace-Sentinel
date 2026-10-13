from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.db.session import build_engine

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _upgrade(engine, revision: str) -> None:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic").replace("%", "%%"))
    with engine.connect() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, revision)


def test_auth_migration_preserves_preexisting_records_in_isolated_database():
    engine = build_engine("sqlite://")
    try:
        _upgrade(engine, "20261011_0004")
        with engine.begin() as connection:
            connection.execute(text("INSERT INTO organizations (id, name, participant_type) VALUES (7, 'Existing Farm', 'farm')"))
            connection.execute(text("INSERT INTO products (id, name) VALUES (9, 'Existing Mango')"))
            connection.execute(text(
                "INSERT INTO batches (id, batch_code, product_id, origin_organization_id, origin_location, quantity, unit) "
                "VALUES (11, 'EXISTING-BATCH', 9, 7, 'Existing location', '12.500', 'kg')"
            ))
            connection.execute(text(
                "INSERT INTO batch_trace_identities (batch_id, trace_id) VALUES (11, '0123456789abcdef0123456789abcdef')"
            ))
            connection.execute(text(
                "INSERT INTO recall_incidents (id, reference_id, root_batch_id, reason, status, created_by) "
                "VALUES (13, 'REC-EXISTING-001', 11, 'Historical record', 'pending_review', 'unverified legacy name')"
            ))

        _upgrade(engine, "head")
        with engine.connect() as connection:
            product = connection.execute(text("SELECT id, name, organization_id FROM products WHERE id = 9")).one()
            batch = connection.execute(text("SELECT batch_code FROM batches WHERE id = 11")).one()
            trace_id = connection.execute(text("SELECT trace_id FROM batch_trace_identities WHERE batch_id = 11")).scalar_one()
            incident = connection.execute(text(
                "SELECT reference_id, created_by, created_by_user_id FROM recall_incidents WHERE id = 13"
            )).one()
            assert product == (9, "Existing Mango", None)
            assert batch.batch_code == "EXISTING-BATCH"
            assert trace_id == "0123456789abcdef0123456789abcdef"
            assert incident == ("REC-EXISTING-001", "unverified legacy name", None)
            assert connection.execute(text("SELECT COUNT(*) FROM users")).scalar_one() == 0
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "20261013_0006"
    finally:
        engine.dispose()
