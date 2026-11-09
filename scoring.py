"""Deterministic risk scoring. The model never produces a number.

Pure functions only, so the score is reproducible and unit-tested.
"""

WEIGHTS = {
    "FAMILY_CLAIM": 15,            # caller says they are a family member
    "AUTHORITY_CLAIM": 25,         # prosecutor, police, FSS, bank
    "URGENCY": 15,
    "MONEY_REQUEST": 30,
    "UNUSUAL_PAYMENT": 20,         # gift cards, cash pickup, "safe account", crypto
    "SECRECY": 20,
    "CHANNEL_SWITCH": 20,          # new number, broken phone, install an app, a link
    "CREDENTIAL_REQUEST": 30,      # OTP, password, ID number, card number
    "DISTRESS_STORY": 10,          # accident, settlement, arrest
    "CONTEXT_CONTRADICTION": 25,   # call contradicts the family wiki
    "PRESENCE_MISMATCH": 30,       # claimed person is not on a call (computed in code)
    "GPS_MISMATCH": 25,            # caller's claimed location vs claimed person's live GPS (code)
}
CODE_TYPES = {"PRESENCE_MISMATCH", "GPS_MISMATCH"}
LLM_TYPES = [t for t in WEIGHTS if t not in CODE_TYPES]

COMBOS = [
    ({"MONEY_REQUEST", "SECRECY"}, 15),
    ({"FAMILY_CLAIM", "MONEY_REQUEST"}, 15),
    ({"AUTHORITY_CLAIM", "MONEY_REQUEST"}, 15),
]

CAUTION_AT = 35
ALERT_AT = 65


def raw_score(types: set[str]) -> int:
    score = sum(WEIGHTS.get(t, 0) for t in types)
    score += sum(bonus for combo, bonus in COMBOS if combo <= types)
    return min(100, score)


def next_score(previous: int, types: set[str]) -> int:
    """Risk only goes up during a call."""
    return max(previous, raw_score(types))


def level(score: int) -> str:
    if score >= ALERT_AT:
        return "ALERT"
    if score >= CAUTION_AT:
        return "CAUTION"
    return "SAFE"


def presence_mismatch(claimed: str | None, members: dict) -> bool:
    """Claimed family member exists and their phone says they are not on a call."""
    if not claimed or claimed not in members:
        return False
    return members[claimed].get("on_call") is False


def gps_mismatch(claimed: str | None, claimed_location: str | None, members: dict) -> bool:
    """Caller names a place; the claimed family member's phone is somewhere else."""
    from verify import contains
    if not claimed or claimed not in members or not claimed_location:
        return False
    gps = members[claimed].get("gps")
    return bool(gps) and not contains(gps, claimed_location)
