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
        "transcript": [], "signals": [], "dropped": [], "claimed": None, "claimed_location": None,
        "score": 0, "level": "SAFE", "verdict": None, "degraded": False,
        "failures": 0, "confirm_requested": False, "alerted": False, "busy": False, "explain": [],
    }


def _seed_wiki() -> dict:
    return {p.stem: p.read_text(encoding="utf-8") for p in sorted(config.SEED_WIKI_DIR.glob("*.md"))}


def _seed_events() -> list:
    """The family's existing week, synced earlier, so new events land among real life."""
    path = config.ROOT / "data" / "seed_events.json"
    if not path.exists():
        return []
    evs = json.loads(path.read_text(encoding="utf-8"))
    return [{**e, "id": new_id("e"), "done": False, "confirmed_by": [], "seed": True} for e in evs]


def _seed_chores() -> list:
    path = config.ROOT / "data" / "seed_chores.json"
    if not path.exists():
        return []
    return [{**c, "id": new_id("c"), "done": False} for c in json.loads(path.read_text(encoding="utf-8"))]


def fresh() -> dict:
    return {
        "members": {k: {**v, "on_call": False, "share_location": False, "consented": False} for k, v in config.MEMBERS.items()},
        "wiki": _seed_wiki(),
        "wiki_highlights": [],
        "approvals": [],
        "events": _seed_events(),
        "chores": _seed_chores(),
        "notifications": [],
        "ingest_log": [],
        "private_topics": [],   # {id, member, topic, shared} — labels only, never chat content
        "call": _empty_call(),
        "perimeter": {"zone": None, "status": "docked", "ts": "", "known": None},
        "robot": {"stage": "docked", "med": "혈압약", "ts": ""},
        "spill": {"stage": "none", "room": "주방"},
        "drone": {"event": "patrol", "ts": ""},
        "reports": [],   # one-tap 112 reports, always confirmed by a family member (SIMULATED: nothing is dialed)
        "home": {"bath": {"status": "idle", "temp": None}, "speaker": "",
                 "lights": {"거실": True, "주방": True, "안방": False, "작은방1": False, "작은방2": False, "욕실": False}},
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
                                      "text": text, "ts": now(), "done": False, **extra})


def log(text: str, tag: str = "sync"):
    """Agent log shown in the hub: every decision the agent makes, newest first."""
    with LOCK:
        S["ingest_log"].insert(0, f"{now()}  [{tag}] {text}")
        del S["ingest_log"][120:]


def snapshot() -> dict:
    with LOCK:
        return copy.deepcopy(S)


def persist():
    """Write the live wiki as real .md files and dump state for debugging."""
    with LOCK:
        for page, text in S["wiki"].items():
            (config.LIVE_WIKI_DIR / f"{page}.md").write_text(text, encoding="utf-8")
        config.STATE_FILE.write_text(json.dumps(S, ensure_ascii=False, indent=1))
