"""Kinproof server. Run: uvicorn server:app --port 8000"""
import asyncio
import json
import re
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import config
import guard
import ingest
import state


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(ingest.watch_inbox())
    yield
    task.cancel()


app = FastAPI(title="Kinproof", lifespan=lifespan)


class InboxIn(BaseModel):
    member: str
    source: str = "chat"
    text: str


class Decision(BaseModel):
    decision: str


class CallStart(BaseModel):
    caller: str = "010-****-7741"


class Utterance(BaseModel):
    text: str


class Presence(BaseModel):
    member: str
    on_call: bool


class Confirm(BaseModel):
    member: str
    is_me: bool


class CallEnd(BaseModel):
    save_as: str | None = None


def _member(m: str):
    if m not in config.MEMBERS:
        raise HTTPException(400, f"unknown member {m}")


@app.get("/api/state")
def get_state():
    s = state.snapshot()
    s["recordings"] = sorted(p.stem for p in config.RECORDINGS_DIR.glob("*.json"))
    s["samples"] = sorted(p.stem for p in config.SAMPLES_DIR.glob("*.md"))
    s["scripts"] = {
        p.stem.replace("_ko", ""): [re.sub(r"\[\[.*?\]\]", "", line).strip()
                                    for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]
        for p in (config.ROOT / "data" / "scenarios").glob("*.txt")
    }
    return s


@app.post("/api/reset")
def reset():
    state.reset()
    return {"ok": True}


@app.post("/api/inbox")
def inbox(body: InboxIn):
    """A conversation arrives (voice note, or a chat synced from an assistant)."""
    _member(body.member)
    name = f"{body.member}_{body.source}_{time.strftime('%H%M%S')}.md"
    md = (f"---\nmember: {body.member}\nsource: {body.source}\n"
          f"captured_at: {time.strftime('%Y-%m-%dT%H:%M')}\n---\n{body.text}\n")
    (config.INBOX_DIR / name).write_text(md, encoding="utf-8")
    return {"file": name}


@app.post("/api/sync/{sample}")
def sync_sample(sample: str):
    """Demo stand-in for auto-sync: copy a sample conversation into the inbox."""
    src = config.SAMPLES_DIR / f"{sample}.md"
    if not src.exists():
        raise HTTPException(404, sample)
    (config.INBOX_DIR / src.name).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    return {"file": src.name}


@app.post("/api/approvals/{approval_id}")
def approval(approval_id: str, body: Decision):
    if not ingest.approve(approval_id, body.decision):
        raise HTTPException(404, approval_id)
    return {"ok": True}


@app.post("/api/events/{event_id}/done")
def event_done(event_id: str):
    with state.LOCK:
        for ev in state.S["events"]:
            if ev["id"] == event_id:
                ev["done"] = True
                return {"ok": True}
    raise HTTPException(404, event_id)


@app.post("/api/call/start")
def call_start(body: CallStart):
    guard.start(body.caller)
    return {"ok": True}


@app.post("/api/call/utterance")
def call_utterance(body: Utterance):
    c = guard.utterance(body.text)
    return {"score": c["score"], "level": c["level"], "signals": len(c["signals"])}


@app.post("/api/presence")
def presence(body: Presence):
    _member(body.member)
    guard.set_presence(body.member, body.on_call)
    return {"ok": True}


@app.post("/api/call/confirm")
def call_confirm(body: Confirm):
    _member(body.member)
    guard.confirm(body.member, body.is_me)
    return {"ok": True}


@app.post("/api/call/end")
def call_end(body: CallEnd):
    guard.end(body.save_as)
    return {"ok": True}


@app.get("/api/recordings/{name}")
def recording(name: str):
    p = config.RECORDINGS_DIR / f"{name}.json"
    if not p.exists():
        raise HTTPException(404, name)
    return json.loads(p.read_text())


@app.get("/")
def root():
    return RedirectResponse("/static/index.html")


app.mount("/static", StaticFiles(directory=config.ROOT / "static"), name="static")
