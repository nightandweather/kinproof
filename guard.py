"""Live call guard: utterance -> model extracts evidence -> code verifies quotes -> code scores.

Final say belongs to a human: the person the caller claims to be confirms or denies.
"""
import json
import time

import config
import llm
import scoring
import state
from verify import contains

MEMBER_IDS = list(config.MEMBERS)

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["claimed_identity", "signals"],
    "properties": {
        "claimed_identity": {"type": ["string", "null"], "enum": MEMBER_IDS + ["authority", None]},
        "signals": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["type", "quote", "quote_en", "wiki_page", "wiki_quote"],
            "properties": {
                "type": {"type": "string", "enum": scoring.LLM_TYPES},
                "quote": {"type": "string"},
                "quote_en": {"type": "string"},
                "wiki_page": {"type": ["string", "null"]},
                "wiki_quote": {"type": ["string", "null"]},
            }}},
    },
}


def system_prompt() -> str:
    tpl = (config.PROMPTS_DIR / "guard.md").read_text(encoding="utf-8")
    return (tpl.replace("{protected}", config.MEMBERS[config.PROTECTED]["name_en"])
               .replace("{member_ids}", ", ".join(MEMBER_IDS))
               .replace("{types}", ", ".join(scoring.LLM_TYPES)))


def start(caller: str):
    state.reset_call()
    with state.LOCK:
        c = state.S["call"]
        c.update(active=True, caller=caller, started=time.time())
        state.S["members"][config.PROTECTED]["on_call"] = True


def _verify(sig: dict, transcript: str, wiki: dict) -> str | None:
    """Return a drop reason, or None if the evidence holds."""
    if not contains(transcript, sig["quote"]):
        return "quote not in call transcript"
    if sig["type"] == "CONTEXT_CONTRADICTION":
        page, wq = sig.get("wiki_page"), sig.get("wiki_quote")
        if not page or page not in wiki or not contains(wiki[page], wq):
            return "wiki quote not in family wiki"
    return None


def _rescore():
    """Recompute score/level from verified signal types + presence. Caller holds LOCK."""
    c = state.S["call"]
    types = {s["type"] for s in c["signals"]}
    if scoring.presence_mismatch(c["claimed"], state.S["members"]):
        if "PRESENCE_MISMATCH" not in types:
            who = config.MEMBERS[c["claimed"]]["name_en"]
            c["signals"].append({"type": "PRESENCE_MISMATCH", "quote": f"{who}'s phone: not on a call",
                                 "quote_en": f"{who} is not on any call right now", "wiki_page": None,
                                 "wiki_quote": None, "by": "code"})
            types.add("PRESENCE_MISMATCH")
    c["score"] = scoring.next_score(c["score"], types)
    c["level"] = scoring.level(c["score"])

    claimed = c["claimed"]
    if (claimed in config.MEMBERS and not c["confirm_requested"] and c["verdict"] is None
            and ("PRESENCE_MISMATCH" in types or c["level"] != "SAFE")):
        c["confirm_requested"] = True
        state.notify(claimed, "confirm_request",
                     f"누군가 '{config.MEMBERS[claimed]['name']}'라며 {config.MEMBERS[config.PROTECTED]['name']}께 전화 중이에요. 본인이세요?")
    if c["level"] == "ALERT" and not c["alerted"]:
        c["alerted"] = True
        state.notify(config.CAREGIVER, "alert",
                     f"{config.MEMBERS[config.PROTECTED]['name']} 통화 위험도 {c['score']} — 사기 의심",
                     evidence=[s["quote"] for s in c["signals"]][:4])


def utterance(text: str) -> dict:
    text = text.strip()
    with state.LOCK:
        c = state.S["call"]
        if not c["active"] or not text:
            return c
        c["transcript"].append({"t": round(time.time() - c["started"], 2), "text": text})
        transcript = "\n".join(u["text"] for u in c["transcript"])
        found = sorted({s["type"] for s in c["signals"]})
        wiki = dict(state.S["wiki"])
        c["busy"] = True

    user = (f"FAMILY WIKI:\n" + "\n\n".join(f"[page: {k}]\n{v}" for k, v in wiki.items())
            + f"\n\nCALL TRANSCRIPT SO FAR:\n{transcript}\n\nNEWEST UTTERANCE:\n{text}"
            + f"\n\nAlready found: {json.dumps(found)}")
    try:
        out = llm.structured("guard", SCHEMA, system_prompt(), user)
        error = None
    except llm.LLMError as e:
        out, error = None, str(e)

    with state.LOCK:
        c = state.S["call"]
        c["busy"] = False
        if out is None:
            c["failures"] += 1
            if c["failures"] >= 2 and (c["signals"] or c["claimed"]) and not c["degraded"]:
                c["degraded"] = True  # fail loud, never silent
                state.notify(config.CAREGIVER, "alert",
                             f"Guardian degraded ({error[:60]}). {config.MEMBERS[config.PROTECTED]['name']}께 직접 전화해 보세요.")
            return c
        c["failures"] = 0
        if out["claimed_identity"] and not c["claimed"]:
            c["claimed"] = out["claimed_identity"]
        have = {s["type"] for s in c["signals"]}
        for sig in out["signals"]:
            if sig["type"] in have:
                continue
            reason = _verify(sig, transcript, wiki)
            if reason:
                c["dropped"].append({**sig, "reason": reason})
                continue
            c["signals"].append({**sig, "by": "model"})
            have.add(sig["type"])
            if sig["type"] == "CONTEXT_CONTRADICTION":
                state.S["wiki_highlights"].append({"page": sig["wiki_page"], "quote": sig["wiki_quote"]})
        _rescore()
        return c


def set_presence(member: str, on_call: bool):
    with state.LOCK:
        state.S["members"][member]["on_call"] = on_call
        if state.S["call"]["active"]:
            _rescore()


def confirm(member: str, is_me: bool):
    with state.LOCK:
        c = state.S["call"]
        if c["claimed"] != member:
            return
        c["verdict"] = "verified" if is_me else "blocked"
        name = config.MEMBERS[member]["name"]
        if is_me:
            state.notify(config.CAREGIVER, "info", f"{name} 본인 확인 완료 — 안전한 통화예요.")
        else:
            state.notify(config.CAREGIVER, "alert", f"{name}가 '본인 아님'을 확인 — 통화를 차단했어요.")
            state.notify(config.PROTECTED, "alert", f"이 전화는 {name}가 아니에요. 끊으세요.")


def end(save_as: str | None = None):
    with state.LOCK:
        c = state.S["call"]
        c["active"] = False
        state.S["members"][config.PROTECTED]["on_call"] = False
        if save_as and c["transcript"]:
            name = "".join(ch for ch in save_as if ch.isalnum() or ch in "-_") or "last"
            (config.RECORDINGS_DIR / f"{name}.json").write_text(
                json.dumps({"caller": c["caller"], "utterances": c["transcript"]}, ensure_ascii=False, indent=1))
    state.persist()
