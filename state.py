"""Single source of truth. The UI only ever renders GET /api/state."""
import copy
import itertools
import json
import threading
import time

import config

LOCK = threading.RLock()
_ids = itertools.count(1)


def new_id(prefix: str) -> str:
    return f"{prefix}{next(_ids)}"


def now() -> str:
    return time.strftime("%H:%M:%S")


def _empty_call() -> dict:
    return {
        "active": False, "target": config.PROTECTED, "caller": "", "started": 0.0,
        "transcript": [], "signals": [], "dropped": [], "claimed": None,
        "score": 0, "level": "SAFE", "verdict": None, "degraded": False,
        "failures": 0, "confirm_requested": False, "alerted": False, "busy": False,
    }


def _seed_wiki() -> dict:
    return {p.stem: p.read_text(encoding="utf-8") for p in sorted(config.SEED_WIKI_DIR.glob("*.md"))}


def fresh() -> dict:
    return {
        "members": {k: {**v, "on_call": False} for k, v in config.MEMBERS.items()},
        "wiki": _seed_wiki(),
        "wiki_highlights": [],
        "approvals": [],
        "events": [],
        "notifications": [],
        "ingest_log": [],
        "call": _empty_call(),
        "mode": config.LLM_MODE,
    }


S = fresh()


def reset():
    global S
    with LOCK:
        S = fresh()
        for p in config.INBOX_DIR.glob("*.md"):
            p.unlink()
        persist()


def reset_call():
    with LOCK:
        S["call"] = _empty_call()
        S["wiki_highlights"] = []


def notify(member: str, kind: str, text: str, **extra):
    with LOCK:
        S["notifications"].insert(0, {"id": new_id("n"), "member": member, "kind": kind,
                                      "text": text, "ts": now(), **extra})


def log(text: str):
    with LOCK:
        S["ingest_log"].insert(0, f"{now()}  {text}")
        del S["ingest_log"][40:]


def snapshot() -> dict:
    with LOCK:
        return copy.deepcopy(S)


def persist():
    """Write the live wiki as real .md files and dump state for debugging."""
    with LOCK:
        for page, text in S["wiki"].items():
            (config.LIVE_WIKI_DIR / f"{page}.md").write_text(text, encoding="utf-8")
        config.STATE_FILE.write_text(json.dumps(S, ensure_ascii=False, indent=1))
