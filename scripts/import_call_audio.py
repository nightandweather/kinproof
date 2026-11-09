"""Turn a call recording (e.g. an ElevenLabs voice-clone of the presenter) into a synced replay.

    python3 scripts/import_call_audio.py path/to/call.mp3 --name scam_clone

Transcribes with OpenAI (segment timestamps), copies the audio next to the UI, and writes
data/recordings/<name>.json. Replaying it plays the real audio while each sentence goes through
the same live guard pipeline at the moment it is spoken.
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import config  # noqa: E402  (loads .env)
from openai import OpenAI  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--name", default="scam_clone")
    ap.add_argument("--caller", default="010-****-7741")
    ap.add_argument("--gap", type=float, default=0.6, help="pause (s) that ends a sentence")
    ap.add_argument("--script", help="known script (one sentence per line): sentence text from the script, timing from the audio")
    args = ap.parse_args()
    src = Path(args.audio).expanduser()
    with src.open("rb") as f:
        tr = OpenAI(timeout=120).audio.transcriptions.create(
            model="whisper-1", file=f, language="ko",
            response_format="verbose_json", timestamp_granularities=["word", "segment"])
    # Split on pauses between words (how a phone STT would finalize sentences), not on Whisper's fixed windows.
    words = [w for w in (tr.words or []) if w.word.strip()]
    utterances, cur, last_end = [], [], None
    for w in words:
        if cur and last_end is not None and float(w.start) - last_end > args.gap:
            utterances.append({"t": round(last_end, 2), "text": " ".join(cur)})
            cur = []
        cur.append(w.word.strip())
        last_end = float(w.end)
    if cur:
        utterances.append({"t": round(last_end, 2), "text": " ".join(cur)})
    if args.script and words:
        import re
        norm = lambda s: re.sub(r"[\s\.,!?~…'\"“”‘’·\-:;()\[\]]+", "", s)
        lines = [re.sub(r"\[\[.*?\]\]", "", l).strip() for l in Path(args.script).read_text(encoding="utf-8").splitlines() if l.strip()]
        total_s = sum(len(norm(l)) for l in lines)
        total_w = sum(len(norm(w.word)) for w in words) or 1
        cum_w, ends = 0, []
        for w in words:
            cum_w += len(norm(w.word))
            ends.append((cum_w / total_w, float(w.end)))
        utterances, cum_s = [], 0
        for line in lines:
            cum_s += len(norm(line))
            frac = cum_s / total_s
            t_end = next((e for f, e in ends if f >= frac - 1e-6), ends[-1][1])
            utterances.append({"t": round(t_end, 2), "text": line})
    if not utterances:  # fall back to segments
        utterances = [{"t": round(float(s.end), 2), "text": s.text.strip()} for s in (tr.segments or []) if s.text.strip()]
    dst = ROOT / "static" / "audio" / f"{args.name}{src.suffix.lower()}"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    rec = {"caller": args.caller, "audio": f"/static/audio/{dst.name}", "utterances": utterances}
    out = config.RECORDINGS_DIR / f"{args.name}.json"
    out.write_text(json.dumps(rec, ensure_ascii=False, indent=1))
    for u in utterances:
        print(f"{u['t']:>6}s  {u['text']}")
    print(f"→ {out.relative_to(ROOT)}  (audio: {dst.relative_to(ROOT)})")


if __name__ == "__main__":
    main()
