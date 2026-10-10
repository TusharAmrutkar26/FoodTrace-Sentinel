import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_ROOT / ".env")

APP_NAME = os.getenv("APP_NAME", "FoodTrace Sentinel API")
APP_ENV = os.getenv("APP_ENV", "development")
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{(BACKEND_ROOT / 'foodtrace.db').as_posix()}",
)
FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
