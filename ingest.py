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
    "required": ["facts", "events"],
    "properties": {
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


def process_text(member: str, source: str, body: str, filename: str) -> int:
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
    if created:
        state.notify(member, "approval", f"AI 대화에서 {created}개 항목을 찾았어요. 가족 위키에 올릴까요?")
    state.log(f"{filename}: {created} proposed, {dropped} dropped (quote not in source), "
              f"private content not extracted")
    return created


def process_file(path) -> None:
    meta, body = parse(path.read_text(encoding="utf-8"))
    member = meta.get("member", config.CAREGIVER)
    source = meta.get("source", "chat")
    state.log(f"synced {path.name} ({member} · {source})")
    try:
        process_text(member, source, body, path.name)
    except llm.LLMError as e:
        state.log(f"{path.name}: LLM failed — {e}")
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
            state.log(f"rejected by {item['member']}: {item['payload'].get('text') or item['payload'].get('title')}")
            return True
        p = item["payload"]
        who = config.MEMBERS[item["member"]]["name"]
        if item["kind"] == "fact":
            page = p["about"]
            line = f"- {p['text']}  <!-- src: {item['file']} · approved by {who} -->"
            state.S["wiki"].setdefault(page, f"# {page}\n")
            state.S["wiki"][page] = state.S["wiki"][page].rstrip() + "\n" + line + "\n"
            state.log(f"wiki/{page}.md += {p['text']}")
        else:
            ev = {"id": state.new_id("e"), "title": p["title"], "date": p["date"], "time": p["time"],
                  "owner": p["owner"], "involves": p["involves"], "done": False}
            state.S["events"].append(ev)
            for n in p["notify"]:
                if n["member"] != item["member"]:
                    state.notify(n["member"], "reminder", n["message"], event=ev["id"])
            state.log(f"event: {p['title']} {p['date']} {p['time'] or ''} → notified "
                      + ", ".join(n["member"] for n in p["notify"]))
    state.persist()
    return True


async def watch_inbox(interval: float = 1.5):
    """The 'auto-sync': any conversation file dropped into inbox/ gets processed."""
    while True:
        for path in sorted(config.INBOX_DIR.glob("*.md")):
            await asyncio.to_thread(process_file, path)
        await asyncio.sleep(interval)
