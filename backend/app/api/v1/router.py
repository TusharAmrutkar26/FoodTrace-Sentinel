from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.batches import router as batches_router
from app.api.v1.batch_events import router as batch_events_router
from app.api.v1.batch_genealogy import router as batch_genealogy_router
from app.api.v1.batch_qr import router as batch_qr_router
from app.api.v1.organizations import router as organizations_router
from app.api.v1.products import router as products_router
from app.api.v1.public_traces import router as public_traces_router
from app.api.v1.recalls import router as recalls_router
from app.api.v1.recall_incidents import router as recall_incidents_router
from app.api.v1.reports import router as reports_router
from app.api.v1.trust import router as trust_router

api_router = APIRouter()
api_router.include_router(auth_router, tags=["authentication"])
api_router.include_router(organizations_router, prefix="/organizations", tags=["organizations"])
api_router.include_router(products_router, prefix="/products", tags=["products"])
api_router.include_router(batches_router, prefix="/batches", tags=["batches"])
api_router.include_router(batch_events_router, tags=["batch events"])
api_router.include_router(batch_genealogy_router, tags=["batch genealogy"])
api_router.include_router(batch_qr_router, tags=["batch QR identity"])
api_router.include_router(public_traces_router, tags=["public trace pages"])
api_router.include_router(trust_router, tags=["TraceTrust"])
api_router.include_router(reports_router, tags=["reports"])
api_router.include_router(recalls_router, tags=["recall simulator"])
api_router.include_router(recall_incidents_router, tags=["recall incidents"])
