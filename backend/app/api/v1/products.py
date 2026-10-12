from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_csrf, require_roles
from app.db.session import get_db
from app.models.product import Product
from app.models.user import User
from app.schemas.product import ProductCreate, ProductPage, ProductRead

router = APIRouter(dependencies=[Depends(get_current_user)])
DbSession = Annotated[Session, Depends(get_db)]
PageLimit = Annotated[int, Query(ge=1, le=100)]
PageOffset = Annotated[int, Query(ge=0, le=10000)]


@router.post("", response_model=ProductRead, status_code=201, dependencies=[Depends(require_csrf), Depends(require_roles("platform_admin", "org_admin", "operator"))])
def create_product(
    payload: ProductCreate,
    session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
) -> Product:
    product = Product(
        **payload.model_dump(),
        organization_id=None if actor.role == "platform_admin" else actor.organization_id,
    )
    session.add(product)
    session.commit()
    session.refresh(product)
    return product


@router.get("", response_model=ProductPage)
def list_products(
    session: DbSession,
    actor: Annotated[User, Depends(get_current_user)],
    limit: PageLimit = 20,
    offset: PageOffset = 0,
) -> ProductPage:
    statement = select(Product)
    count_statement = select(func.count(Product.id))
    if actor.role != "platform_admin":
        statement = statement.where(
            (Product.organization_id.is_(None)) | (Product.organization_id == actor.organization_id)
        )
        count_statement = count_statement.where(
            (Product.organization_id.is_(None)) | (Product.organization_id == actor.organization_id)
        )
    total = session.scalar(count_statement) or 0
    items = session.scalars(
        statement.order_by(Product.name, Product.id).limit(limit).offset(offset)
    ).all()
    return ProductPage(items=list(items), total=total, limit=limit, offset=offset)
