"""Live call guard: utterance -> model extracts evidence -> code verifies quotes -> code scores.

Final say belongs to a human: the person the caller claims to be confirms or denies.
"""
import json
import re
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
    "required": ["claimed_identity", "claimed_location", "signals"],
    "properties": {
        "claimed_location": {"type": ["string", "null"]},
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
    g = config.MEMBERS[config.PROTECTED]["name_en"]
    state.log(f"📞 {g} is on a call with {caller} — transcription started", "call")
    for m, v in config.MEMBERS.items():
        if m != config.PROTECTED:
            state.log(f"📍 {v['name_en']} is at {v['gps']} right now", "gps")


def _verify(sig: dict, transcript: str, wiki: dict) -> str | None:
    """Return a drop reason, or None if the evidence holds."""
    if not contains(transcript, sig["quote"]):
        return "quote not in call transcript"
    if sig["type"] == "CONTEXT_CONTRADICTION":
        page, wq = sig.get("wiki_page"), sig.get("wiki_quote")
        if not page or page not in wiki or not contains(wiki[page], wq):
            return "wiki quote not in family wiki"
    return None


def _josa(name: str, pair: str) -> str:
    """Korean particle after a name: 지훈 -> 지훈이는 / 할머니 -> 할머니는."""
    last = name[-1]
    batchim = "가" <= last <= "힣" and (ord(last) - 0xAC00) % 28 != 0
    return name + ("이" if batchim else "") + pair


def _short(text: str, n: int = 22) -> str:
    text = text.strip("- ").split(",")[0].rstrip(".")
    return text if len(text) <= n else text[:n] + "…"


def _explain(c) -> list[str]:
    """Plain-language reason, built by code from verified facts only (Korean line + English line)."""
    m = c["claimed"]
    if m not in config.MEMBERS:
        return []
    name = config.MEMBERS[m]["name"]
    name_en = config.MEMBERS[m]["name_en"]
    types = {s["type"] for s in c["signals"]}
    gps = state.S["members"][m].get("gps", "")
    place = re.sub(r"\s*\(.*?\)", "", gps).split()[-1] if gps else ""
    ko, en = [], []
    if "GPS_MISMATCH" in types:
        ko.append(f"{_josa(name, '는')} 지금 {place}에 있는데, 전화한 사람은 {c['claimed_location']}에 있다고 하네요")
        en.append(f"{name_en} is in {place} right now, but the caller says {c['claimed_location']}")
    if state.S["members"][m].get("dnd") and not state.S["members"][m].get("on_call"):
        status = state.S["members"][m].get("status", "근무 중")
        ko.append(f"{status}이라 방해금지 모드예요")
        en.append(f"{name_en} is at work with Do Not Disturb on")
    if "PRESENCE_MISMATCH" in types:
        ko.append(f"{_josa(name, '')} 폰은 지금 아무와도 통화 중이 아니에요".replace("이 폰", " 폰"))
        en.append(f"{name_en}'s phone is not on any call")
    wq = next((s["wiki_quote"] for s in c["signals"] if s["type"] == "CONTEXT_CONTRADICTION"), None)
    if wq:
        ko.append(f"가족 위키엔 '{_short(wq)}'라고 돼 있어요")
        en.append("the family wiki says otherwise")
    if "MONEY_REQUEST" in types:
        ko.append("그런데 돈을 보내 달라고 해요")
        en.append("and they are asking for money")
    return [". ".join(ko) + "." if ko else "", "; ".join(en) + "." if en else ""]


def _rescore():
    """Recompute score/level from verified signal types + presence. Caller holds LOCK."""
    c = state.S["call"]
    types = {s["type"] for s in c["signals"]}
    if scoring.presence_mismatch(c["claimed"], state.S["members"]):
        if "PRESENCE_MISMATCH" not in types:
            who = config.MEMBERS[c["claimed"]]["name_en"]
            state.log(f"presence check: {who} is NOT on a call → +30", "presence")
            c["signals"].append({"type": "PRESENCE_MISMATCH", "quote": f"{who}'s phone: not on a call",
                                 "quote_en": f"{who} is not on any call right now", "wiki_page": None,
                                 "wiki_quote": None, "by": "code"})
            types.add("PRESENCE_MISMATCH")
    if scoring.gps_mismatch(c["claimed"], c.get("claimed_location"), state.S["members"]):
        if "GPS_MISMATCH" not in types:
            who = config.MEMBERS[c["claimed"]]["name_en"]
            gps = state.S["members"][c["claimed"]]["gps"]
            state.log(f"📍 caller says '{c['claimed_location']}', {who}'s GPS says {gps} → +25", "gps")
            c["signals"].append({"type": "GPS_MISMATCH", "quote": f"{who}'s GPS: {gps}",
                                 "quote_en": f"Caller claims '{c['claimed_location']}', but {who} is at {gps}",
                                 "wiki_page": None, "wiki_quote": None, "by": "code"})
            types.add("GPS_MISMATCH")
    c["score"] = scoring.next_score(c["score"], types)
    c["level"] = scoring.level(c["score"])
    new_explain = _explain(c)
    if new_explain and new_explain[0] and new_explain != c.get("explain"):
        c["explain"] = new_explain
        state.log(f"🧠 {new_explain[0]}", "reason")

    claimed = c["claimed"]
    if (claimed in config.MEMBERS and not c["confirm_requested"] and c["verdict"] is None
            and ("PRESENCE_MISMATCH" in types or c["level"] != "SAFE")):
        c["confirm_requested"] = True
        state.log(f"asked {claimed}: 'Is this you?'", "presence")
        state.notify(claimed, "confirm_request",
                     f"누군가 '{config.MEMBERS[claimed]['name']}'라며 {config.MEMBERS[config.PROTECTED]['name']}께 전화 중이에요. 본인이세요?")
    if c["confirm_requested"] and state.S["members"].get(claimed, {}).get("dnd") and not c.get("dnd_logged"):
        c["dnd_logged"] = True
        state.log(f"{claimed} is in Do Not Disturb (at work) → identity check sent as an emergency, bypassing DND", "presence")
    if c["level"] == "ALERT" and not c["alerted"]:
        c["alerted"] = True
        why = c["explain"][0] if c.get("explain") and c["explain"][0] else ""
        for who in {config.CAREGIVER, getattr(config, "ADMIN", config.CAREGIVER)}:
            state.notify(who, "alert",
                         f"{config.MEMBERS[config.PROTECTED]['name']} 통화 위험도 {c['score']} — 사기 의심. {why}",
                         evidence=[s["quote"] for s in c["signals"]][:4])


def utterance(text: str) -> dict:
    text = text.strip()
    with state.LOCK:
        c = state.S["call"]
        if not c["active"] or not text:
            return c
        c["transcript"].append({"t": round(time.time() - c["started"], 2), "text": text})
        state.log(f"caller: “{text}”", "transcript")
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
            state.log(f"model call failed ({c['failures']}x): {error[:60]}", "error")
            if c["failures"] >= 2 and (c["signals"] or c["claimed"]) and not c["degraded"]:
                c["degraded"] = True  # fail loud, never silent
                state.notify(config.CAREGIVER, "alert",
                             f"Guardian degraded ({error[:60]}). {config.MEMBERS[config.PROTECTED]['name']}께 직접 전화해 보세요.")
            return c
        c["failures"] = 0
        if out["claimed_identity"] and not c["claimed"]:
            c["claimed"] = out["claimed_identity"]
            label = "an authority" if c["claimed"] == "authority" else config.MEMBERS.get(c["claimed"], {}).get("name_en", c["claimed"])
            state.log(f"caller claims to be {label} — verifying identity", "call")
        if out.get("claimed_location") and not c.get("claimed_location") and contains(transcript, out["claimed_location"]):
            c["claimed_location"] = out["claimed_location"]
        have = {s["type"] for s in c["signals"]}
        before = c["score"]
        for sig in out["signals"]:
            if sig["type"] in have:
                continue
            reason = _verify(sig, transcript, wiki)
            if reason:
                c["dropped"].append({**sig, "reason": reason})
                state.log(f"dropped {sig['type']}: {reason} (\"{sig['quote'][:30]}\")", "verify")
                continue
            state.log(f"{sig['type']} ← \"{sig['quote'][:36]}\"" + (f" ↔ wiki/{sig['wiki_page']}.md" if sig.get('wiki_quote') else ""), "evidence")
            c["signals"].append({**sig, "by": "model"})
            have.add(sig["type"])
            if sig["type"] == "CONTEXT_CONTRADICTION":
                state.S["wiki_highlights"].append({"page": sig["wiki_page"], "quote": sig["wiki_quote"]})
        _rescore()
        if c["score"] != before:
            state.log(f"risk {before} → {c['score']} ({c['level']})", "score")
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
        state.log(f"{member} answered {'It is me' if is_me else 'Not me'} → call {c['verdict']}", "verdict")
        name = config.MEMBERS[member]["name"]
        if is_me:
            state.notify(config.CAREGIVER, "info", f"{name} 본인 확인 완료 — 안전한 통화예요.")
        else:
            for who in {config.CAREGIVER, getattr(config, "ADMIN", config.CAREGIVER)}:
                state.notify(who, "alert", f"{_josa(name, '가')} '본인 아님'을 확인 — 통화를 차단했어요.")
            state.notify(config.PROTECTED, "alert", f"이 전화는 {_josa(name, '가')} 아니에요. 끊으세요.")


def end(save_as: str | None = None):
    with state.LOCK:
        c = state.S["call"]
        if c["active"]:
            state.log(f"call ended · {len(c['transcript'])} lines · risk {c['score']} · verdict {c['verdict'] or 'none'}", "call")
        c["active"] = False
        state.S["members"][config.PROTECTED]["on_call"] = False
        if save_as and c["transcript"]:
            name = "".join(ch for ch in save_as if ch.isalnum() or ch in "-_") or "last"
            (config.RECORDINGS_DIR / f"{name}.json").write_text(
                json.dumps({"caller": c["caller"], "utterances": c["transcript"]}, ensure_ascii=False, indent=1))
    state.persist()
