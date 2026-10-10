from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.product import Product
from app.schemas.product import ProductCreate, ProductPage, ProductRead

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]
PageLimit = Annotated[int, Query(ge=1, le=100)]
PageOffset = Annotated[int, Query(ge=0, le=10000)]


@router.post("", response_model=ProductRead, status_code=201)
def create_product(payload: ProductCreate, session: DbSession) -> Product:
    product = Product(**payload.model_dump())
    session.add(product)
    session.commit()
    session.refresh(product)
    return product


@router.get("", response_model=ProductPage)
def list_products(
    session: DbSession,
    limit: PageLimit = 20,
    offset: PageOffset = 0,
) -> ProductPage:
    total = session.scalar(select(func.count(Product.id))) or 0
    items = session.scalars(
        select(Product).order_by(Product.name, Product.id).limit(limit).offset(offset)
    ).all()
    return ProductPage(items=list(items), total=total, limit=limit, offset=offset)
