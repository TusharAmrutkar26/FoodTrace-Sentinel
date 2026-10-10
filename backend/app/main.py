from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import APP_ENV, APP_NAME, FRONTEND_ORIGINS

app = FastAPI(title=APP_NAME, debug=APP_ENV == "development")

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    """Report that the API process is responding."""
    return {"status": "ok"}


app.include_router(api_router, prefix="/api/v1")
