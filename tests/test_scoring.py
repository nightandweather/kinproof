import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scoring  # noqa: E402
from verify import contains  # noqa: E402

SCAM = {"FAMILY_CLAIM", "CHANNEL_SWITCH", "DISTRESS_STORY", "URGENCY", "MONEY_REQUEST", "SECRECY"}
REAL = {"FAMILY_CLAIM"}


def test_scam_call_alerts():
    assert scoring.level(scoring.raw_score(SCAM)) == "ALERT"


def test_real_family_call_stays_safe():
    assert scoring.level(scoring.raw_score(REAL)) == "SAFE"


def test_presence_mismatch_alone_with_claim_reaches_caution():
    assert scoring.level(scoring.raw_score({"FAMILY_CLAIM", "PRESENCE_MISMATCH"})) == "CAUTION"


def test_score_never_decreases():
    assert scoring.next_score(80, {"FAMILY_CLAIM"}) == 80


def test_combo_bonus():
    assert scoring.raw_score({"MONEY_REQUEST", "SECRECY"}) == 30 + 20 + 15


def test_cap_100():
    assert scoring.raw_score(set(scoring.WEIGHTS)) == 100


def test_presence_mismatch_rules():
    members = {"jihoon": {"on_call": False}, "mom": {"on_call": True}}
    assert scoring.presence_mismatch("jihoon", members)
    assert not scoring.presence_mismatch("mom", members)
    assert not scoring.presence_mismatch("authority", members)
    assert not scoring.presence_mismatch(None, members)


def test_quote_verification_tolerates_stt_spacing():
    transcript = "할머니 나야 지훈이. 폰이 깨져서 친구 폰으로 전화했어"
    assert contains(transcript, "폰이 깨져서 친구폰으로")
    assert contains(transcript, "할머니, 나야 지훈이")
    assert not contains(transcript, "계좌로 보내줘")
    assert not contains(transcript, "나")  # too short to count as evidence
