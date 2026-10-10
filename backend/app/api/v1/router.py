from fastapi import APIRouter

from app.api.v1.batches import router as batches_router
from app.api.v1.batch_events import router as batch_events_router
from app.api.v1.batch_genealogy import router as batch_genealogy_router
from app.api.v1.organizations import router as organizations_router
from app.api.v1.products import router as products_router

api_router = APIRouter()
api_router.include_router(organizations_router, prefix="/organizations", tags=["organizations"])
api_router.include_router(products_router, prefix="/products", tags=["products"])
api_router.include_router(batches_router, prefix="/batches", tags=["batches"])
api_router.include_router(batch_events_router, tags=["batch events"])
api_router.include_router(batch_genealogy_router, tags=["batch genealogy"])
