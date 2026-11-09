"""Evidence check: a quote only counts if it really appears in its source.

Speech-to-text and the model disagree on spacing and punctuation, so both
sides are normalized (NFC, lowercase, whitespace and punctuation removed)
before the substring test.
"""
import re
import unicodedata

_STRIP = re.compile(r"[\s\.,!?~…'\"“”‘’·\-:;()\[\]]+")


def norm(text: str | None) -> str:
    text = unicodedata.normalize("NFC", text or "").lower()
    return _STRIP.sub("", text)


def contains(haystack: str | None, needle: str | None, min_len: int = 2) -> bool:
    n = norm(needle)
    return len(n) >= min_len and n in norm(haystack)
