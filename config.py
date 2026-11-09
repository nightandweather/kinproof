"""Single place for family members, paths and runtime settings."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

# Family members. Change names here only.
MEMBERS = {
    "grandma": {"name": "할머니", "name_en": "Grandma", "role": "protected elder (78)", "emoji": "👵"},
    "mom": {"name": "엄마", "name_en": "Mom", "role": "primary caregiver", "emoji": "👩"},
    "jihoon": {"name": "지훈", "name_en": "Ji-hoon", "role": "grandson (29)", "emoji": "👨"},
}
PROTECTED = "grandma"   # who receives the calls
CAREGIVER = "mom"       # who gets scam alerts

MODEL_FAST = os.getenv("KP_MODEL_FAST", "")
MODEL_SMART = os.getenv("KP_MODEL_SMART", "") or MODEL_FAST
LLM_MODE = os.getenv("KP_LLM_MODE", "record")  # live | record | replay
LLM_TIMEOUT = float(os.getenv("KP_LLM_TIMEOUT", "25"))
TODAY = os.getenv("KP_TODAY", "2026-11-09 (Mon)")

SEED_WIKI_DIR = ROOT / "wiki"
LIVE_WIKI_DIR = ROOT / "data" / "wiki"
INBOX_DIR = ROOT / "inbox"
PROCESSED_DIR = INBOX_DIR / "processed"
SAMPLES_DIR = ROOT / "samples"
CACHE_DIR = ROOT / "data" / "cache"
RECORDINGS_DIR = ROOT / "data" / "recordings"
PROMPTS_DIR = ROOT / "prompts"
STATE_FILE = ROOT / "data" / "state.json"

for d in (LIVE_WIKI_DIR, INBOX_DIR, PROCESSED_DIR, CACHE_DIR, RECORDINGS_DIR):
    d.mkdir(parents=True, exist_ok=True)
