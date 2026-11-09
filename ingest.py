"""AI conversations -> proposed wiki facts and events -> owner approves -> wiki + reminders.

Conversations land in inbox/*.md (the "auto-sync"). Nothing reaches the shared
wiki until the person whose conversation it was approves it.
"""
import asyncio
import re

import config
import llm
import state
from verify import contains

MEMBER_IDS = list(config.MEMBERS)

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["facts", "events", "kept_private"],
    "properties": {
        "kept_private": {"type": "array", "items": {"type": "string"}},
        "facts": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["about", "text", "source_quote"],
            "properties": {
                "about": {"type": "string", "enum": MEMBER_IDS + ["family"]},
                "text": {"type": "string"},
                "source_quote": {"type": "string"},
            }}},
        "events": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["title", "date", "time", "owner", "involves", "notify", "source_quote"],
            "properties": {
                "title": {"type": "string"},
                "date": {"type": "string"},
                "time": {"type": ["string", "null"]},
                "owner": {"type": "string", "enum": MEMBER_IDS},
                "involves": {"type": "array", "items": {"type": "string", "enum": MEMBER_IDS}},
                "notify": {"type": "array", "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["member", "message"],
                    "properties": {
                        "member": {"type": "string", "enum": MEMBER_IDS},
                        "message": {"type": "string"},
                    }}},
                "source_quote": {"type": "string"},
            }}},
    },
}

_FRONT = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.S)


def parse(md: str) -> tuple[dict, str]:
    m = _FRONT.match(md)
    if not m:
        return {}, md
    meta = dict(line.split(":", 1) for line in m.group(1).splitlines() if ":" in line)
    return {k.strip(): v.strip() for k, v in meta.items()}, m.group(2)


def system_prompt() -> str:
    tpl = (config.PROMPTS_DIR / "ingest.md").read_text(encoding="utf-8")
    return tpl.replace("{member_ids}", ", ".join(MEMBER_IDS)).replace("{today}", config.TODAY)


def process_text(member: str, source: str, body: str, filename: str, auto_approve: bool = False) -> int:
    roster = "\n".join(f"- {k}: {v['name']} ({v['role']})" for k, v in config.MEMBERS.items())
    user = f"Family members:\n{roster}\n\nAuthor: {member} via {source}\n\nConversation:\n{body}"
    out = llm.structured("ingest", SCHEMA, system_prompt(), user, model=config.MODEL_SMART)

    created = dropped = 0
    for kind in ("facts", "events"):
        for item in out.get(kind, []):
            if not contains(body, item["source_quote"]):
                dropped += 1
                continue
            with state.LOCK:
                state.S["approvals"].append({
                    "id": state.new_id("a"), "member": member, "kind": kind[:-1],
                    "payload": item, "source": source, "file": filename,
                })
            created += 1
    if created and auto_approve:
        with state.LOCK:
            mine = [a["id"] for a in state.S["approvals"] if a["file"] == filename]
        for aid in mine:
            approve(aid, "approve")
        state.log(f"{member}'s own voice note → applied directly (no approval step for the elder)", "voice")
    elif created:
        state.notify(member, "approval", f"AI 대화에서 {created}개 항목을 찾았어요. 가족 위키에 올릴까요?")
    kept = out.get("kept_private", [])
    state.log(f"{filename}: {created} proposals for {member}'s approval, {dropped} dropped (quote not in source)", "extract")
    if kept:
        state.log(f"kept private, not extracted: {', '.join(kept)}", "privacy")
        with state.LOCK:
            for topic in kept:
                state.S["private_topics"].append({"id": state.new_id("p"), "member": member, "topic": topic, "shared": False})
    return created


def _duplicate_of(p: dict) -> dict | None:
    """Same date and time, overlapping people -> the same real-world event from another chat."""
    for ev in state.S["events"]:
        same_when = ev["date"] == p["date"] and (ev["time"] or "") == (p["time"] or "")
        people = set(ev["involves"]) | {ev["owner"]}
        if same_when and people & (set(p["involves"]) | {p["owner"]}):
            return ev
    return None


def process_file(path) -> None:
    meta, body = parse(path.read_text(encoding="utf-8"))
    member = meta.get("member", config.CAREGIVER)
    source = meta.get("source", "chat")
    state.log(f"synced {path.name} ({member} · {source})", "sync")
    try:
        process_text(member, source, body, path.name)
    except llm.LLMError as e:
        state.log(f"{path.name}: LLM failed, {e}", "error")
    finally:
        path.rename(config.PROCESSED_DIR / path.name)
        state.persist()


def approve(approval_id: str, decision: str) -> bool:
    with state.LOCK:
        item = next((a for a in state.S["approvals"] if a["id"] == approval_id), None)
        if not item:
            return False
        state.S["approvals"].remove(item)
        if decision != "approve":
            state.log(f"kept private by {item['member']}: {item['payload'].get('text') or item['payload'].get('title')}", "privacy")
            return True
        p = item["payload"]
        who = config.MEMBERS[item["member"]]["name"]
        if item["kind"] == "fact":
            page = p["about"]
            line = f"- {p['text']}  <!-- src: {item['file']} · approved by {who} -->"
            state.S["wiki"].setdefault(page, f"# {page}\n")
            state.S["wiki"][page] = state.S["wiki"][page].rstrip() + "\n" + line + "\n"
            state.log(f"wiki/{page}.md += {p['text']}", "wiki")
        elif (dup := _duplicate_of(p)) is not None:
            dup.setdefault("confirmed_by", []).append(who)
            state.log(f"merged duplicate: {dup['title']}, also confirmed by {who}", "schedule")
        else:
            ev = {"id": state.new_id("e"), "title": p["title"], "date": p["date"], "time": p["time"],
                  "owner": p["owner"], "involves": p["involves"], "done": False, "confirmed_by": [who]}
            state.S["events"].append(ev)
            for n in p["notify"]:
                if n["member"] != item["member"]:
                    state.notify(n["member"], "reminder", n["message"], event=ev["id"])
            state.log(f"{p['title']} {p['date']} {p['time'] or ''} → reminded "
                      + ", ".join(n["member"] for n in p["notify"]), "schedule")
    state.persist()
    return True


async def watch_inbox(interval: float = 1.5):
    """The 'auto-sync': any conversation file dropped into inbox/ gets processed."""
    while True:
        for path in sorted(config.INBOX_DIR.glob("*.md")):
            await asyncio.to_thread(process_file, path)
        await asyncio.sleep(interval)


VOICE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["intent", "target", "message", "reply"],
    "properties": {
        "intent": {"type": "string", "enum": ["add_plan", "ask", "call", "relay", "other"]},
        "target": {"type": ["string", "null"], "enum": MEMBER_IDS + [None]},
        "message": {"type": ["string", "null"]},
        "reply": {"type": "string"},
    },
}


# How Grandma refers to each family member (her replies should use her words, not the app's labels)
ELDER_NAMES = {"dad": "준호", "mom": "미경이", "jihoon": "지훈이", "grandma": "할머니"}


def _call_name(speaker: str, m: str) -> str:
    return ELDER_NAMES.get(m, config.MEMBERS[m]["name"]) if speaker == config.PROTECTED else config.MEMBERS[m]["name"]


def voice(member: str, text: str) -> dict:
    """Elder speaks; Kinproof does the rest. Plans go straight into the family schedule, questions get answered."""
    name = config.MEMBERS[member]["name"]
    state.log(f"🎤 {name}: “{text}”", "voice")
    with state.LOCK:
        events = "\n".join(f"- {e['date']} {e['time'] or ''} {e['title']} (owner {e['owner']})" for e in state.S["events"])
        wiki = "\n\n".join(state.S["wiki"].values())
    roster = ", ".join(f"{k}={v['name']}" for k, v in config.MEMBERS.items())
    system = ("You are a warm voice assistant for an older Korean adult. Reply in short, polite, simple Korean (1-2 sentences, 존댓말). "
              f"Today is {config.TODAY}. Family ids: {roster} (준호/아들/아범 = dad, 미경/며느리/어미 = mom, 지훈/손자 = jihoon). "
              "intent=add_plan if they are telling a plan/appointment; ask if they ask about the family schedule or family; "
              "call if they want to phone a family member (target = that id); relay if they want a message passed to a family member "
              "(target = id, message = the message rewritten as a short Korean text from Grandma); other otherwise. "
              "For ask, answer ONLY from the schedule and wiki given. For add_plan, briefly confirm what you understood.")
    user = f"FAMILY SCHEDULE:\n{events}\n\nFAMILY WIKI:\n{wiki}\n\n{name} said: {text}"
    try:
        out = llm.structured("voice", VOICE_SCHEMA, system, user)
    except llm.LLMError as e:
        state.log(f"voice failed: {e}", "error")
        return {"intent": "other", "reply": "죄송해요, 다시 한 번 말씀해 주세요."}
    reply = out["reply"]
    if out["intent"] == "add_plan":
        before = {e["id"] for e in state.S["events"]}
        fname = f"{member}_voice_{state.now().replace(':', '')}.md"
        process_text(member, "voice", f"User: {text}", fname, auto_approve=True)
        with state.LOCK:
            new = [e for e in state.S["events"] if e["id"] not in before]
            told = sorted({n["member"] for n in state.S["notifications"] if n.get("event") in {e["id"] for e in new}})
        if told:
            reply += " " + ", ".join(_call_name(member, m) for m in told if m in config.MEMBERS) + "에게도 알려드렸어요."
    target = out.get("target")
    if out["intent"] == "call" and target in config.MEMBERS:
        tn = _call_name(member, target)
        state.notify(target, "alert", f"📞 {name}가 지금 통화를 원하세요. 할머니께 전화해 주세요.")
        state.log(f"{name} asked to call {target} → call request sent to {tn}'s phone", "voice")
        reply = f"{tn}에게 전화 연결을 요청했어요. 곧 전화 올 거예요."
    elif out["intent"] == "relay" and target in config.MEMBERS and out.get("message"):
        tn = _call_name(member, target)
        state.notify(target, "reminder", f"💬 {name}: {out['message']}")
        state.log(f"{name} → {target}: “{out['message']}” (relayed by voice)", "voice")
        reply = f"{tn}에게 전해 드렸어요."
    state.notify(member, "info", reply)
    state.log(f"🔊 reply to {name}: {reply}", "voice")
    state.persist()
    return {"intent": out["intent"], "reply": reply}
