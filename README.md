# Kinproof

**Voice isn't proof anymore. Family is.**

Kinproof turns a family's everyday AI conversations (ChatGPT, Claude, local models, voice notes) into a private,
consent-based **family wiki**. One family context, many protections: the same wiki that reminds everyone about
Grandma's hospital visit is the one that catches a voice-clone scammer lying to her.

Built in 5 hours at **c0mpiled-17 Seoul** for YC RFS **AI for the Aging Population** × **Proving You're Human**.

> Koreans lost ₩1.26 trillion (~$900M) to voice phishing in 2025, up 47% (police data via National Assembly analysis).
> US adults 60+ reported $7.75B in fraud losses to the FBI in 2025, up 59%.

## What it does

1. **Auto-sync AI chats → family wiki.** A conversation lands in `inbox/`. The model extracts only family-relevant
   facts and dated events, and names what it deliberately kept private ("이직 고민", "연애 선물"). Nothing is shared
   until the person whose chat it was taps **Share**.
2. **Shared schedule → per-person reminders.** Mom tells ChatGPT she's taking Grandma to the hospital Thursday at 2.
   Grandma and Ji-hoon each get the reminder that matters to them. The same event mentioned in two people's chats is merged.
3. **Live call guard.** Grandma gets a call: "할머니, 나야 지훈이. 폰이 깨져서…"
   - Speech-to-text → the model extracts evidence as **verbatim quotes**
   - Code verifies every quote exists in the call transcript, and every wiki quote exists in the wiki — invented evidence is dropped
   - Code computes a deterministic, monotonic risk score
   - **Live presence check:** the caller claims to be Ji-hoon, but Ji-hoon's phone is not on a call → his phone asks *"Is this you?"*
   - **Contradiction:** "I'm in Busan" vs. the wiki line Ji-hoon himself approved: "판교 사무실 출근 this week"
   - Ji-hoon taps **Not me** → call blocked. The real person has the final say.
4. **Real family, no false alarm.** When the real Ji-hoon calls, he is on a call and the story matches the wiki: score stays SAFE.

## Design principles

| Principle | How |
|---|---|
| The model extracts, code decides | Scores, presence, verdicts are plain Python (`scoring.py`), unit-tested |
| Evidence or it didn't happen | `verify.py` substring-checks every quote (normalized for STT spacing) |
| Fail loud, not silent | Two model failures mid-call → caregiver alerted "Guardian degraded" |
| Privacy by minimal disclosure | Facts, not chats. Owner approval. Presence = "on a call or not", nothing else |
| Family-scale context fits in one prompt | The whole wiki goes into the prompt — no vector DB, fully inspectable |
| Demo survives bad Wi-Fi | `KP_LLM_MODE=record` caches real responses; `replay` re-runs them on the same code path |

## Architecture

```
inbox/*.md ──watch──▶ ingest.py ──OpenAI structured outputs──▶ proposals ──owner approves──▶ wiki + events ──▶ reminders
                                                                                              │
Chrome Web Speech ──utterance──▶ guard.py ──OpenAI structured outputs──▶ verify.py ──▶ scoring.py ──▶ confirm request ──▶ verdict
                                     ▲ whole family wiki in prompt                        ▲ presence (Ji-hoon on a call?)
```

- `server.py` FastAPI; the UI polls `GET /api/state` (single source of truth)
- `llm.py` OpenAI Structured Outputs (strict JSON schema) + record/replay cache
- `ingest.py` chats → facts/events/kept_private, quote-verified, approval-gated, de-duplicated
- `guard.py` call evidence extraction, verification, presence, confirmation
- `scoring.py` / `verify.py` pure functions with tests (`tests/`)

## Run

```bash
pip install -r requirements.txt
cp .env.example .env          # OPENAI_API_KEY, KP_MODEL_FAST / KP_MODEL_SMART (we used gpt-6-sol)
uvicorn server:app --port 8000
# open http://localhost:8000 in Chrome (Web Speech API)
pytest -q
```

Demo: **Sync ChatGPT** (Mom) and **Sync Claude** (Ji-hoon) → **Share** the proposals → **Start live call** and read
`data/scenarios/scam_ko.txt` → Ji-hoon taps **Not me**. Saved calls can be replayed from the **Replay** menu or `?replay=scam`.

## Honest limits / roadmap

- ChatGPT/Claude subscriptions have no public API for pulling chats. The demo syncs exported conversations; the product
  direction is exposing the wiki as an **MCP connector** each family member adds to their own assistant.
- Presence is a toggle in the demo; on a phone it would come from the OS call state reported by a family app.
- Web Speech sends audio to Google; production would use on-device STT.
- Next on the same wiki: medication check-ins, caregiver hand-offs, a shared scam-pattern network across families.
