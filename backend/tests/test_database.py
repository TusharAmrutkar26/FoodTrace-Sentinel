import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import build_engine
from app.models.batch import Batch


def test_sqlite_foreign_keys_are_enabled_and_enforced():
    engine = build_engine("sqlite://", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    try:
        with engine.connect() as connection:
            assert connection.scalar(text("PRAGMA foreign_keys")) == 1

        with Session(engine) as session:
            session.add(
                Batch(
                    batch_code="MNG-ORPHAN",
                    product_id=999,
                    origin_organization_id=999,
                    origin_location="Unknown",
                    quantity="1.00",
                    unit="kg",
                )
            )
            with pytest.raises(IntegrityError):
                session.commit()
            session.rollback()
    finally:
        engine.dispose()
