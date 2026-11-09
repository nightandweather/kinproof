"""Texts and app notifications on the elder's phone: smishing, payments, transfers.

The model reads the message; code decides. A large transfer right after a suspicious call is the
classic end of a voice-phishing script, so timing is a deterministic rule, not a model guess.
"""
import time

import config
import llm
import state

SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["kind", "amount_krw", "counterparty", "has_link", "impersonates", "summary_ko"],
    "properties": {
        "kind": {"type": "string", "enum": ["payment", "transfer", "smishing", "family", "normal"]},
        "amount_krw": {"type": ["integer", "null"]},
        "counterparty": {"type": ["string", "null"]},
        "has_link": {"type": "boolean"},
        "impersonates": {"type": ["string", "null"]},
        "summary_ko": {"type": "string"},
    },
}
SYSTEM = """You read one SMS or app notification received on an older Korean adult's phone and extract facts only.
kind: payment (card/app payment approved), transfer (money sent out of their account), smishing (asks to click a link,
install an app, verify an account, or impersonates a delivery company, bank, government or family to get money/data),
family (a normal message from family), normal (anything else harmless: appointments, ads without links).
amount_krw: the amount if any, as an integer in won. counterparty: merchant or recipient. has_link: true if it contains a URL.
impersonates: who it pretends to be (e.g. "택배사", "은행", "검찰", "가족") or null. summary_ko: one short Korean sentence."""

BIG_AMOUNT = 1_000_000          # ₩
AFTER_CALL_WINDOW_S = 30 * 60   # a transfer within 30 min of a suspicious call


def receive(member: str, sender: str, text: str) -> dict:
    try:
        out = llm.structured("message", SCHEMA, SYSTEM, f"From: {sender}\n{text}")
    except llm.LLMError as e:
        state.log(f"message analysis failed: {e}", "error")
        out = {"kind": "normal", "amount_krw": None, "counterparty": None, "has_link": "http" in text,
               "impersonates": None, "summary_ko": text[:40]}

    with state.LOCK:
        c = state.S["call"]
        suspicious_call = c["level"] == "ALERT" or c["verdict"] == "blocked"
        since_call = time.time() - (c.get("started") or 0)
    amount = out["amount_krw"] or 0
    reasons = []
    if out["kind"] == "smishing" or (out["has_link"] and out["impersonates"]):
        reasons.append(f"링크 포함 · {out['impersonates'] or '사칭'} 사칭 의심")
    if out["kind"] in ("transfer", "payment") and amount >= BIG_AMOUNT:
        reasons.append(f"{amount:,}원 큰 금액")
    if out["kind"] in ("transfer", "payment") and suspicious_call and since_call < AFTER_CALL_WINDOW_S:
        reasons.append("사기 의심 전화 직후")
    risk = "high" if len(reasons) >= 2 or out["kind"] == "smishing" else ("watch" if reasons else "ok")

    msg = {"id": state.new_id("m"), "member": member, "sender": sender, "text": text, "ts": state.now(),
           "kind": out["kind"], "amount": amount, "summary": out["summary_ko"], "reasons": reasons, "risk": risk}
    with state.LOCK:
        state.S["messages"].insert(0, msg)
    state.log(f"📩 {sender}: {out['kind']}{f' {amount:,}원' if amount else ''} → {risk}" + (f" ({', '.join(reasons)})" if reasons else ""), "message")

    g = config.MEMBERS[member]["name"]
    if risk == "high":
        if out["kind"] in ("transfer", "payment"):
            text_ = f"💸 {g} 계좌에서 {amount:,}원 출금, {', '.join(reasons)}. 은행에 지급정지를 요청할까요?"
        else:
            text_ = f"📩 {g}께 스미싱 의심 문자가 왔어요: “{out['summary_ko']}”, 링크를 누르지 마시라고 안내했어요."
            state.notify(member, "alert", "🔊 이 문자의 링크는 누르지 마세요. 가족에게 알렸어요.")
        for who in {config.CAREGIVER, getattr(config, "ADMIN", config.CAREGIVER)}:
            state.notify(who, "alert", text_, msg=msg["id"])
    state.persist()
    return msg


def hold(member: str, msg_id: str) -> bool:
    """Family asks the bank to hold a transfer. SIMULATED: no bank is contacted."""
    with state.LOCK:
        m = next((x for x in state.S["messages"] if x["id"] == msg_id), None)
        if not m or m.get("held"):
            return False
        m["held"] = config.MEMBERS[member]["name_en"]
    state.log(f"{config.MEMBERS[member]['name_en']} requested a payment hold for {m['amount']:,}원, SIMULATED, no bank contacted", "message")
    for who in config.MEMBERS:
        if who != config.PROTECTED:
            state.notify(who, "info", f"🏦 {m['amount']:,}원 지급정지 요청 완료 (데모: 실제 은행 연동 없음)")
    return True
