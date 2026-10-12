"""Idempotently add clearly fictional FoodTrace demonstration records.

Run from the backend directory with ``python -m app.scripts.seed_demo_data``.
The command uses the configured DATABASE_URL and never deletes or rewrites rows.
"""

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.batch import Batch
from app.models.batch_genealogy import BatchGenealogy
from app.models.organization import Organization
from app.models.product import Product
from app.schemas.batch import BatchCreate
from app.schemas.batch_genealogy import GenealogyCreate, RelationshipType
from app.schemas.common import Unit
from app.services.batch_genealogy import (
    GenealogyConflict,
    GenealogyValidationError,
    create_relationship,
)
from app.services.batches import create_batch


@dataclass(frozen=True)
class SeedSummary:
    products_added: int = 0
    products_reused: int = 0
    organizations_added: int = 0
    organizations_reused: int = 0
    batches_added: int = 0
    batches_reused: int = 0
    genealogy_added: int = 0
    genealogy_reused: int = 0
    genealogy_skipped: int = 0


PRODUCT_NAMES = ("Mango", "Tomato", "Rice", "Wheat", "Milk", "Onion")
ORGANIZATION_SPECS = (
    ("Mango Farm", "supplier"),
    ("Green Valley Farms", "supplier"),
    ("Sunrise Agro", "producer"),
    ("Shree Farms", "producer"),
    ("Fresh Dairy Co.", "producer"),
    ("Maharashtra Agro", "supplier"),
)

# Each batch is fictional and uses only fields supported by the current model.
# Two mango packing lots are children of the mango harvest lot so the demo has
# an explicit, valid split that can be inspected in the genealogy screens.
BATCH_SPECS = (
    ("MNG-201", "Mango", "Mango Farm", "Ratnagiri, Maharashtra", "1000.000", Unit.KILOGRAM),
    ("TOM-201", "Tomato", "Green Valley Farms", "Nashik, Maharashtra", "600.000", Unit.KILOGRAM),
    ("RIC-201", "Rice", "Sunrise Agro", "Kolhapur, Maharashtra", "500.000", Unit.KILOGRAM),
    ("WHT-201", "Wheat", "Shree Farms", "Pune, Maharashtra", "750.000", Unit.KILOGRAM),
    ("MLK-201", "Milk", "Fresh Dairy Co.", "Satara, Maharashtra", "1200.000", Unit.LITRE),
    ("ONI-201", "Onion", "Maharashtra Agro", "Nashik, Maharashtra", "420.000", Unit.KILOGRAM),
    ("MNG-202", "Mango", "Mango Farm", "Ratnagiri packing shed, Maharashtra", "350.000", Unit.KILOGRAM),
    ("MNG-203", "Mango", "Mango Farm", "Ratnagiri packing shed, Maharashtra", "275.000", Unit.KILOGRAM),
)

SPLIT_SPECS = (("MNG-201", "MNG-202", "350.000"), ("MNG-201", "MNG-203", "275.000"))


def _natural_key(value: str) -> str:
    return " ".join(value.split()).casefold()


def _existing_by_name(session: Session, model: type[Product] | type[Organization]):
    by_name = {}
    for record in session.scalars(select(model).order_by(model.id)).all():
        # If old data already contains duplicate display names, choose the
        # lowest-ID record consistently and leave every duplicate untouched.
        by_name.setdefault(_natural_key(record.name), record)
    return by_name


def _batch_by_code(session: Session, code: str) -> Batch | None:
    return session.scalar(
        select(Batch).where(Batch.batch_code == code.upper())
    )


def seed_demo_data(session: Session) -> SeedSummary:
    """Create missing demo records, reusing matches without modifying them."""
    products = _existing_by_name(session, Product)
    organizations = _existing_by_name(session, Organization)
    products_added = 0
    products_reused = 0
    for name in PRODUCT_NAMES:
        key = _natural_key(name)
        if key in products:
            products_reused += 1
            continue
        product = Product(name=name)
        session.add(product)
        session.flush()
        products[key] = product
        products_added += 1

    organizations_added = 0
    organizations_reused = 0
    for name, participant_type in ORGANIZATION_SPECS:
        key = _natural_key(name)
        if key in organizations:
            organizations_reused += 1
            continue
        organization = Organization(name=name, participant_type=participant_type)
        session.add(organization)
        session.flush()
        organizations[key] = organization
        organizations_added += 1

    batch_records: dict[str, Batch] = {}
    batches_added = 0
    batches_reused = 0
    for code, product_name, organization_name, location, quantity, unit in BATCH_SPECS:
        existing = _batch_by_code(session, code)
        if existing is not None:
            # Existing batch details and trace identity are authoritative.
            batch_records[code] = existing
            batches_reused += 1
            continue
        product = products[_natural_key(product_name)]
        organization = organizations[_natural_key(organization_name)]
        created = create_batch(
            session,
            BatchCreate(
                batch_code=code,
                product_id=product.id,
                origin_organization_id=organization.id,
                origin_location=location,
                quantity=quantity,
                unit=unit,
            ),
        )
        batch_records[code] = created
        batches_added += 1

    genealogy_added = 0
    genealogy_reused = 0
    genealogy_skipped = 0
    for parent_code, child_code, quantity in SPLIT_SPECS:
        parent = batch_records[parent_code]
        child = batch_records[child_code]
        existing_link = session.scalar(
            select(BatchGenealogy).where(
                BatchGenealogy.parent_batch_id == parent.id,
                BatchGenealogy.child_batch_id == child.id,
            )
        )
        if existing_link is not None:
            genealogy_reused += 1
            continue

        source_quantity = Decimal(quantity)
        if parent.unit != Unit.KILOGRAM.value or source_quantity > parent.quantity:
            # Do not attach a demo edge to a pre-existing batch with
            # incompatible or insufficient quantity data.
            genealogy_skipped += 1
            continue
        try:
            create_relationship(
                session,
                GenealogyCreate(
                    parent_batch_id=parent.id,
                    child_batch_id=child.id,
                    relationship_type=RelationshipType.SPLIT,
                    source_quantity=quantity,
                    source_unit=Unit.KILOGRAM,
                ),
            )
            genealogy_added += 1
        except (GenealogyConflict, GenealogyValidationError):
            # Preserve the existing graph if it makes the demo edge invalid.
            genealogy_skipped += 1

    session.commit()
    return SeedSummary(
        products_added=products_added,
        products_reused=products_reused,
        organizations_added=organizations_added,
        organizations_reused=organizations_reused,
        batches_added=batches_added,
        batches_reused=batches_reused,
        genealogy_added=genealogy_added,
        genealogy_reused=genealogy_reused,
        genealogy_skipped=genealogy_skipped,
    )


def main() -> None:
    with SessionLocal() as session:
        result = seed_demo_data(session)
    print("FoodTrace Sentinel fictional demo data seed complete.")
    print(f"Products: {result.products_added} added, {result.products_reused} reused")
    print(f"Organizations: {result.organizations_added} added, {result.organizations_reused} reused")
    print(f"Batches: {result.batches_added} added, {result.batches_reused} reused")
    print(
        "Genealogy links: "
        f"{result.genealogy_added} added, {result.genealogy_reused} reused, "
        f"{result.genealogy_skipped} skipped to preserve existing data"
    )


if __name__ == "__main__":
    main()
