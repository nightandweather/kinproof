"""End-to-end guard flow with the model stubbed out: verification, presence, verdict."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import guard  # noqa: E402
import llm  # noqa: E402
import state  # noqa: E402

SCRIPT = {
    "할머니 나야 지훈이": {"claimed_identity": "jihoon", "signals": [
        {"type": "FAMILY_CLAIM", "quote": "할머니 나야 지훈이", "quote_en": "Grandma it's Ji-hoon",
         "wiki_page": None, "wiki_quote": None}]},
    "폰이 깨져서 친구 폰으로 전화했어": {"claimed_identity": "jihoon", "signals": [
        {"type": "CHANNEL_SWITCH", "quote": "폰이 깨져서 친구 폰으로", "quote_en": "phone broke",
         "wiki_page": None, "wiki_quote": None},
        # hallucinated evidence: not in the transcript -> must be dropped
        {"type": "MONEY_REQUEST", "quote": "천만원 보내", "quote_en": "send 10M",
         "wiki_page": None, "wiki_quote": None}]},
    "나 지금 부산인데 사고 났어": {"claimed_identity": "jihoon", "signals": [
        {"type": "CONTEXT_CONTRADICTION", "quote": "나 지금 부산인데", "quote_en": "I'm in Busan",
         "wiki_page": "jihoon", "wiki_quote": "평일엔 강남 사무실로 출근"},
        # wiki quote that does not exist -> must be dropped
        {"type": "DISTRESS_STORY", "quote": "사고 났어", "quote_en": "accident",
         "wiki_page": None, "wiki_quote": None}]},
}


def fake_structured(name, schema, system, user, model=None):
    newest = user.split("NEWEST UTTERANCE:\n")[1].split("\n")[0]
    out = dict(SCRIPT[newest])
    out.setdefault("claimed_location", "부산" if "부산" in newest else None)
    return out


def run(monkeypatch, jihoon_on_call: bool):
    monkeypatch.setattr(llm, "structured", fake_structured)
    state.reset()
    guard.set_presence("jihoon", jihoon_on_call)
    guard.start("010-0000-0000")
    for line in SCRIPT:
        guard.utterance(line)
    return state.S["call"]


def test_scam_flow(monkeypatch):
    c = run(monkeypatch, jihoon_on_call=False)
    types = {s["type"] for s in c["signals"]}
    assert "MONEY_REQUEST" not in types                     # hallucinated quote dropped
    assert {"FAMILY_CLAIM", "CHANNEL_SWITCH", "PRESENCE_MISMATCH", "GPS_MISMATCH", "CONTEXT_CONTRADICTION", "DISTRESS_STORY"} <= types
    assert any(d["reason"].startswith("quote not in call") for d in c["dropped"])
    assert c["level"] == "ALERT"
    assert c["confirm_requested"]
    assert state.S["wiki_highlights"][0]["page"] == "jihoon"
    guard.confirm("jihoon", is_me=False)
    assert c["verdict"] == "blocked"


def test_real_grandson_on_call_no_presence_flag(monkeypatch):
    c = run(monkeypatch, jihoon_on_call=True)
    assert "PRESENCE_MISMATCH" not in {s["type"] for s in c["signals"]}


def test_model_outage_fails_loud(monkeypatch):
    def broken(*a, **k):
        raise llm.LLMError("timeout")
    monkeypatch.setattr(llm, "structured", fake_structured)
    state.reset()
    guard.start("x")
    guard.utterance("할머니 나야 지훈이")
    monkeypatch.setattr(llm, "structured", broken)
    guard.utterance("a")
    guard.utterance("b")
    assert state.S["call"]["degraded"]
    assert any(n["kind"] == "alert" and n["member"] == "mom" for n in state.S["notifications"])
