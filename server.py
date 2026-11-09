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
import home
import ingest
import messages
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
    on_call: bool | None = None
    dnd: bool | None = None


class Confirm(BaseModel):
    member: str
    is_me: bool


class MemberIn(BaseModel):
    name_en: str
    name: str = ""
    emoji: str = "🙂"
    gps: str = ""
    role: str = "family"


class Motion(BaseModel):
    zone: str = "back fence"
    known: bool | None = None


class Consent(BaseModel):
    member: str
    share: bool
    onboarding: bool = False


class VoiceIn(BaseModel):
    member: str = "grandma"
    text: str


class RobotStep(BaseModel):
    stage: str          # start | water | pills | deliver | taken | no_answer | docked
    med: str = "혈압약"


class HomeCmd(BaseModel):
    member: str
    text: str


class Spill(BaseModel):
    stage: str   # detect | cleaning | done | none


class DroneEvent(BaseModel):
    event: str   # patrol | stranger | wander | home


class Report(BaseModel):
    member: str
    kind: str     # scam | wander


class MessageIn(BaseModel):
    member: str = "grandma"
    sender: str
    text: str


class Hold(BaseModel):
    member: str


class Share(BaseModel):
    member: str


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
                ev["done"] = not ev.get("done")
                return {"ok": True}
    raise HTTPException(404, event_id)


@app.post("/api/notifications/{nid}/done")
def notification_done(nid: str):
    with state.LOCK:
        for n in state.S["notifications"]:
            if n["id"] == nid:
                n["done"] = not n.get("done")
                return {"ok": True}
    raise HTTPException(404, nid)


@app.post("/api/members")
def add_member(body: MemberIn):
    """Add a family member to the hub (display + schedule; call claims use the configured roster)."""
    mid = "".join(ch for ch in body.name_en.lower() if ch.isalnum()) or state.new_id("m")
    with state.LOCK:
        if mid in state.S["members"]:
            raise HTTPException(409, mid)
        state.S["members"][mid] = {"name": body.name or body.name_en, "name_en": body.name_en, "emoji": body.emoji,
                                   "gps": body.gps, "role": body.role, "on_call": False}
        state.S["wiki"].setdefault(mid, f"# {body.name or body.name_en}\n")
    state.log(f"added family member {body.name_en}, wiki/{mid}.md created", "wiki")
    return {"id": mid}


@app.post("/api/perimeter")
def perimeter(body: Motion):
    """SIMULATED yard sensor + drone. known=None: motion detected -> dispatch; known=True/False: drone result."""
    g = config.MEMBERS[config.PROTECTED]["name_en"]
    with state.LOCK:
        per = state.S["perimeter"]
        if body.known is None:
            per.update(zone=body.zone, status="dispatched", ts=state.now(), known=None)
            state.log(f"motion at {g}'s {body.zone} → door camera checking (simulated sensor)", "home")
        else:
            per.update(status="identified", known=body.known)
            if body.known:
                state.log(f"door camera: person at {body.zone} matches family → no alert", "home")
            else:
                state.log(f"door camera: unknown person lingering at {body.zone} for 40s → snapshot sent to {config.CAREGIVER}", "home")
                state.notify(config.CAREGIVER, "alert", f"🚪 {g} 댁 현관 앞에 모르는 사람이 40초째 서 있어요. 도어캠 사진을 보냈어요. 할머니께는 문 열지 마시라고 안내했어요.")
                state.notify(config.PROTECTED, "alert", "현관 앞에 모르는 사람이 있어요. 문 열지 마세요. 엄마에게 알렸어요.")
    return {"ok": True}


@app.post("/api/perimeter/dock")
def perimeter_dock():
    with state.LOCK:
        state.S["perimeter"].update(zone=None, status="docked", known=None)
    return {"ok": True}


@app.post("/api/consent")
def consent(body: Consent):
    """Location sharing with the family admin. The map unlocks only when every member agrees."""
    _member(body.member)
    with state.LOCK:
        state.S["members"][body.member]["share_location"] = body.share
        if body.onboarding:
            state.S["members"][body.member]["consented"] = body.share
        ms = state.S["members"]
        if body.onboarding:
            ready = sum(1 for v in ms.values() if v.get("consented"))
            state.log(f"{ms[body.member]['name_en']} installed Kinproof and agreed: AI-chat facts (with approval), call status, location · {ready}/{len(ms)}", "privacy")
            if ready == len(ms):
                state.log("everyone agreed → family protection is ON", "privacy")
        n = sum(1 for v in ms.values() if v.get("share_location"))
        admin = ms[config.ADMIN]["name_en"]
        state.log(f"{ms[body.member]['name_en']} {'agreed to share' if body.share else 'stopped sharing'} location with {admin} (admin) · {n}/{len(ms)}", "privacy")
        if n == len(ms):
            state.log(f"all {n} members consented → family map unlocked for {admin}", "privacy")
    return {"ok": True}


@app.post("/api/topics/{tid}/share")
def share_topic(tid: str):
    """The member, not the admin, decides whether a kept-private topic label is visible to the admin."""
    with state.LOCK:
        for pt in state.S["private_topics"]:
            if pt["id"] == tid:
                pt["shared"] = not pt["shared"]
                who = config.MEMBERS.get(pt["member"], {}).get("name_en", pt["member"])
                state.log(f"{who} {'shared' if pt['shared'] else 'un-shared'} topic label '{pt['topic']}' with admin", "privacy")
                return {"ok": True}
    raise HTTPException(404, tid)


@app.post("/api/voice")
def voice(body: VoiceIn):
    _member(body.member)
    return ingest.voice(body.member, body.text)


@app.post("/api/robot")
def robot(body: RobotStep):
    """SIMULATED home robot: brings water + the right pill pouch at medication time, confirms, reports to family."""
    g = config.MEMBERS[config.PROTECTED]["name"]
    msgs = {
        "start": (f"💊 {body.med} 시간 → home robot started (from family schedule)", None),
        "water": ("robot: picked up a cup of water in the kitchen", None),
        "pills": (f"robot: picked the {body.med} pouch for today (morning slot)", None),
        "deliver": (f"robot: delivered water + {body.med} to {g} in the living room · asked “약 드셨어요?”",
                    (config.PROTECTED, "reminder", f"{g}, {body.med} 드실 시간이에요. 물이랑 약 가져왔어요.")),
        "taken": (f"{g} said she took it → logged, caregiver notified",
                  (config.CAREGIVER, "info", f"{g} {body.med} 복용 완료 ✓ (로봇 확인 {state.now()[:5]})")),
        "no_answer": (f"no answer from {g} for 10 min → escalated to caregiver",
                      (config.CAREGIVER, "alert", f"{g}께서 {body.med}에 응답이 없어요. 전화 한번 드려 보세요.")),
        "docked": ("robot: back on the charging dock", None),
    }
    if body.stage not in msgs:
        raise HTTPException(400, body.stage)
    text, note = msgs[body.stage]
    with state.LOCK:
        state.S["robot"].update(stage=body.stage, med=body.med, ts=state.now())
    state.log(text, "robot")
    if note:
        state.notify(*note)
    return {"ok": True}


@app.post("/api/chores/{cid}/done")
def chore_done(cid: str):
    with state.LOCK:
        for c in state.S["chores"]:
            if c["id"] == cid:
                c["done"] = not c["done"]
                who = config.MEMBERS.get(c["member"], {}).get("name_en", c["member"])
                state.log(f"{who} {'finished' if c['done'] else 'reopened'} chore: {c['title']}", "chores")
                return {"ok": True}
    raise HTTPException(404, cid)


@app.post("/api/laundry")
def laundry():
    """SIMULATED smart washer finished -> whoever owns the drying chore gets the nudge."""
    with state.LOCK:
        chore = next((c for c in state.S["chores"] if "건조대" in c["title"]), None)
    who = chore["member"] if chore else config.CAREGIVER
    state.log(f"washer (베란다) finished → nudged {who} for '{chore['title'] if chore else 'laundry'}'", "home")
    state.notify(who, "reminder", "🧺 세탁 끝났어요! 건조대에 널어 주세요. (오늘 집안일 담당)")
    return {"ok": True}


@app.post("/api/home")
def home_command(body: HomeCmd):
    _member(body.member)
    return home.command(body.member, body.text)


@app.post("/api/spill")
def spill(body: Spill):
    """SIMULATED robot patrol: water on the floor is a fall risk for an older adult. Photo before and after."""
    g = config.MEMBERS[config.PROTECTED]["name"]
    with state.LOCK:
        state.S["spill"]["stage"] = body.stage
    if body.stage == "detect":
        state.log("robot camera: water on the kitchen floor in front of the sink → fall risk, photo saved", "robot")
        state.notify(config.PROTECTED, "info", "🔊 홈스피커: 주방 바닥에 물이 있어요. 미끄러우니 조심하세요. 제가 닦을게요.")
    elif body.stage == "cleaning":
        state.log("robot: mopping the spill (kitchen)", "robot")
    elif body.stage == "done":
        state.log("robot: floor dry → after-photo saved, caregiver notified", "robot")
        state.notify(config.CAREGIVER, "photo", f"🤖 {g} 댁 주방 바닥 물기를 발견해서 닦았어요. 낙상 위험 해결 ✓",
                     photos=["/static/img/spill_before.jpg", "/static/img/spill_after.jpg"])
    return {"ok": True}


@app.post("/api/drone")
def drone(body: DroneEvent):
    """SIMULATED complex-patrol drone outside Grandma's apartment building."""
    g = config.MEMBERS[config.PROTECTED]["name"]
    admin = getattr(config, "ADMIN", config.CAREGIVER)
    with state.LOCK:
        state.S["drone"].update(event=body.event, ts=state.now())
    if body.event == "stranger":
        state.log("drone patrol: person loitering at 101동 entrance for 5+ min, checking mailboxes → snapshot", "drone")
        for who in {config.CAREGIVER, admin}:
            state.notify(who, "alert", f"🚁 {g} 댁 101동 출입구 앞에 모르는 사람이 5분 넘게 서성여요. 드론 사진을 보냈어요.")
        state.notify(config.PROTECTED, "info", "🔊 홈스피커: 1층 출입구에 낯선 사람이 있어요. 지금은 나가지 마세요.")
    elif body.event == "wander":
        state.log(f"drone: {g} left the building alone at 23:40 → following at a distance, live location to family", "drone")
        for who in {config.CAREGIVER, admin, "jihoon"}:
            state.notify(who, "alert", f"🚁 할머니가 밤 11시 40분에 혼자 단지 밖으로 나가셨어요. 드론이 따라가며 위치를 보내고 있어요: 단지 정문 → 버스정류장 방향.")
    elif body.event == "home":
        state.log(f"drone: {g} back inside 101동 → family notified, drone returns to patrol", "drone")
        state.notify(config.CAREGIVER, "info", f"🏠 {g} 무사히 귀가하셨어요. (드론 확인)")
    return {"ok": True}


@app.post("/api/report")
def report(body: Report):
    """A family member confirms a 112 report. Never automatic. SIMULATED: no call is placed."""
    _member(body.member)
    who = config.MEMBERS[body.member]["name_en"]
    with state.LOCK:
        if any(r["kind"] == body.kind for r in state.S["reports"]):
            return {"ok": True, "duplicate": True}
        c = state.S["call"]
        if body.kind == "scam":
            pack = {"caller": c["caller"], "time": state.now(), "quotes": [s["quote"] for s in c["signals"] if s.get("by") != "code"],
                    "reasons": (c.get("explain") or [""])[0]}
            summary = f"caller {c['caller']}, {len(pack['quotes'])} quotes, verdict {c['verdict']}"
        else:
            pack = {"time": state.now(), "last_seen": "단지 정문 → 버스정류장 방향 (drone)"}
            summary = "missing-person request with drone live location"
        state.S["reports"].append({"kind": body.kind, "by": body.member, "ts": state.now(), "pack": pack})
    state.log(f"{who} confirmed 112 report ({body.kind}): {summary}, SIMULATED, nothing dialed", "report")
    for m in config.MEMBERS:
        if m != config.PROTECTED:
            state.notify(m, "info", f"🚨 {config.MEMBERS[body.member]['name']}가 112에 신고했어요 ({'보이스피싱' if body.kind == 'scam' else '실종 우려'}). 증거 묶음 전송 완료 (데모: 실제 발신 없음)")
    return {"ok": True}


@app.post("/api/message")
def message(body: MessageIn):
    _member(body.member)
    return messages.receive(body.member, body.sender, body.text)


@app.post("/api/message/{mid}/hold")
def message_hold(mid: str, body: Hold):
    _member(body.member)
    return {"ok": messages.hold(body.member, mid)}


@app.post("/api/community/share")
def community_share(body: Share):
    """Opt-in: share the blocked call's PATTERN (no names, no transcript) with nearby Kinproof families."""
    _member(body.member)
    with state.LOCK:
        c = state.S["call"]
        com = state.S["community"]
        if c.get("shared") or c["verdict"] != "blocked":
            return {"ok": False}
        types = {s["type"] for s in c["signals"]}
        parts = []
        if "FAMILY_CLAIM" in types: parts.append("가족 사칭")
        if "AUTHORITY_CLAIM" in types: parts.append("기관 사칭")
        if "CHANNEL_SWITCH" in types: parts.append("'폰 고장/친구 폰'")
        if "DISTRESS_STORY" in types: parts.append("사고 이야기")
        if "MONEY_REQUEST" in types: parts.append("송금 요구")
        if "SECRECY" in types: parts.append("비밀 유지 요구")
        com["feed"].insert(0, {"ago": "방금", "area": "송파구 (우리 가족)", "pattern": " · ".join(parts) or "사칭 전화",
                               "number": c["caller"], "families": 1, "mine": True})
        com["blocklist"][c["caller"]] = com["blocklist"].get(c["caller"], 0) + 1
        c["shared"] = True
        n = com["families"]
    state.log(f"{config.MEMBERS[body.member]['name_en']} shared the scam pattern with {n} families in {com['area']} (no names, no transcript)", "community")
    return {"ok": True}


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
    if body.dnd is not None:
        with state.LOCK:
            state.S["members"][body.member]["dnd"] = body.dnd
    if body.on_call is not None:
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
