"""Runtime configuration. Every secret comes from environment variables, never from code."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"

# Postgres / Supabase: postgresql://user:pass@host:5432/db  (SQLite is used when unset)
DATABASE_URL = os.getenv("DATABASE_URL") or f"sqlite:///{DATA_DIR / 'reports.db'}"

# Screenshot reading. OCR_PROVIDER = auto | anthropic | tesseract | manual
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")
OCR_PROVIDER = os.getenv("OCR_PROVIDER", "auto").lower()

MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "15"))
REPORT_TIMEZONE = os.getenv("REPORT_TIMEZONE", "Asia/Kolkata")

# Optional browser login (HTTP Basic). Leave both empty to disable.
APP_USERNAME = os.getenv("APP_USERNAME", "")
APP_PASSWORD = os.getenv("APP_PASSWORD", "")

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
FRONTEND_DIST = Path(os.getenv("FRONTEND_DIST", ROOT.parent / "frontend" / "dist"))


def ocr_provider() -> str:
    if OCR_PROVIDER in ("anthropic", "tesseract", "manual"):
        return OCR_PROVIDER
    return "anthropic" if ANTHROPIC_API_KEY else "tesseract"
