# Kinproof

**Voice isn't proof anymore. Family is.**

Kinproof turns a family's everyday AI conversations (ChatGPT, Claude, local models, voice notes) into a private,
consent-based **family wiki**. One family context, many protections: the same wiki that reminds everyone about
Grandma's hospital visit is the one that catches a voice-clone scammer lying to her.

Built in 5 hours at **c0mpiled-17 Seoul** for YC RFS **AI for the Aging Population** × **Proving You're Human**.

> Koreans lost ₩1.26 trillion (~$900M) to voice phishing in 2025, up 47% (police data via National Assembly analysis).
> US adults 60+ reported $7.75B in fraud losses to the FBI in 2025, up 59%.

## What it does

**The family:** Grandma (78) lives alone in a Songpa apartment. Mom is a nurse at Bundang SNU Hospital, Dad a developer in
Pangyo (family admin), grandson Ji-hoon works in Gangnam. Four phones, one family context.

0. **Everyone opts in.** Each member installs Kinproof and agrees (AI-chat facts with approval, "on a call?" status, location).
   Protection turns on only when all four agree.
1. **Auto-sync AI chats → family wiki.** A conversation lands in `inbox/`. The model extracts only family-relevant facts and
   dated events, and names what it deliberately kept private ("이직 고민", "연애 선물"). Nothing is shared until the person whose
   chat it was taps **Share**. Kept-private topics stay labels only; a member may choose to share a label with the admin.
2. **Shared schedule → per-person reminders.** Mom tells ChatGPT she's taking Grandma to the hospital Thursday at 2: Grandma and
   Ji-hoon each get their reminder. Duplicates across chats merge. Week calendar, hour-by-member timetable, chores split.
3. **Grandma just talks.** One big button. Plans go straight into the family schedule; questions ("이번 주 금요일에 뭐 있어?") are
   answered from the schedule and read aloud.
4. **Live call guard (the core).** Grandma gets a call: "할머니, 나야 지훈이. 폰이 깨져서…"
   - Speech-to-text → the model extracts evidence as **verbatim quotes**; code verifies every call quote and wiki quote — invented evidence is dropped
   - Code computes a deterministic, monotonic risk score from evidence + checks a clone cannot copy:
     - **Presence:** Ji-hoon's real phone is not on any call (defeats spoofed caller ID and cloned SIMs)
     - **GPS:** caller says Busan, Ji-hoon's phone is in Gangnam (only "match / no match" is used — the location is never shown)
     - **Wiki:** "this week at the Gangnam office", approved from Ji-hoon's own Claude chat
     - **Do Not Disturb:** he is at work with DND on — the identity check is sent as an emergency that bypasses DND
   - The voice itself is shown as **"sounds like Ji-hoon — not trusted"**: clones sound the same, so we verify instead of detect
   - A plain-language reason built by code ("지훈이는 지금 강남에 있는데, 전화한 사람은 부산에 있다고 하네요…")
   - Ji-hoon taps **Not me** → blocked; Mom and Dad are told why. The real person has the final say.
   - Real Ji-hoon calling at lunch: on a call, story matches → stays SAFE.
5. **Grandma's home (SIMULATED devices, 34평 apartment).** Robot brings water + the right pill pouch and confirms intake; spots water
   on the kitchen floor, warns Grandma, mops it, sends before/after photos; door camera flags a stranger; washer nudges whoever owns
   the drying chore. Family members can **ask the home** by text ("목욕물 받아줘", "할머니께 7시에 데리러 간다고 전해줘"):
   bath capped at 40 °C in code, door/gas requests refused in code.
6. **Home Protector & map.** One screen with calendar/timetable, to-dos, family status (GPS, on a call, DND), agent log of every
   decision. Family map for the admin unlocks only when everyone consents (OpenStreetMap).

**Demo helpers:** ▶ Story mode plays "a day with the Kim family" with captions. `?as=jihoon` turns any phone (e.g. a real iPhone)
into that member's app with a bottom tab bar. `scripts/import_call_audio.py` turns a call recording (e.g. an ElevenLabs clone of the
presenter's own voice) into a replay: timing from the audio, sentence text aligned to the known script, audio played in sync.

## Design principles

| Principle | How |
|---|---|
| The model extracts, code decides | Scores, presence, verdicts are plain Python (`scoring.py`), unit-tested |
| Evidence or it didn't happen | `verify.py` substring-checks every quote (normalized for STT spacing) |
| Fail loud, not silent | Two model failures mid-call → caregiver alerted "Guardian degraded" |
| Privacy by minimal disclosure | Facts, not chats. Owner approval. Presence = "on a call or not", nothing else |
| Family-scale context fits in one prompt | The whole wiki goes into the prompt — no vector DB, fully inspectable |
| Demo survives bad Wi-Fi | `KP_LLM_MODE=record` caches real responses; `replay` re-runs them on the same code path |

**Why not an autonomous agent?** Blocking a call or a transfer is a safety decision, so no agent loop gets to make it.
Each model call is a single, schema-constrained extraction (claims + verbatim quotes); verification, scoring and the
verdict are deterministic code. *AI gathers the evidence. Verifiable code makes the call. A hallucination can't move
Grandma's money.* Next: a proactive family agent that reads the shared calendar and reaches out first (e.g. reminds Mom
about Grandma's clinic visit and sorts out who drives) — acting only on low-stakes coordination, never on money.

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

## Business model (assumptions marked)

- **Family plan: ₩9,900 / month** (~$7) for up to 6 members — one subscription protects the elder, the whole family uses it.
- **Why families pay:** the average 2025 voice-phishing loss in Korea was ~₩53.8M per case (police data via National Assembly analysis).
  Preventing **one** case equals **~453 family-years** of subscription.
- **Korea scenarios** (assumption: ~2M older adults living alone — verify):

  | Adoption | Families | ARR |
  |---|---|---|
  | 0.5% | 10,000 | ₩1.19B (~$0.9M) |
  | 1% | 20,000 | ₩2.38B (~$1.7M) |
  | 5% | 100,000 | ₩11.9B (~$8.6M) |

- **B2B2C channels:** telcos (add-on next to existing anti-phishing services), banks and insurers (fewer fraud payouts),
  local governments' elder-care programs for seniors living alone.
- **Cost structure:** model calls happen only on chat sync, voice requests and suspicious calls — no always-on streaming to the cloud.

## Honest limits / roadmap

- ChatGPT/Claude subscriptions have no public API for pulling chats. The demo syncs exported conversations; the product
  direction is exposing the wiki as an **MCP connector** each family member adds to their own assistant.
- Presence, GPS, DND and all home devices (robot, door camera, washer, bath, speaker) are simulated in the demo; in the product they
  come from a family app reporting OS call state / location and from home device APIs.
- Spill photos are AI-generated stand-ins for a robot camera (labeled "simulated cam" in the UI).
- Web Speech sends audio to Google; production would use on-device STT.
- Next on the same wiki: medication check-ins, caregiver hand-offs, a shared scam-pattern network across families.

### Coming next

1. **Kinproof community app.** Families who use Kinproof share scam numbers, scripts and alerts by neighbourhood
   (the demo's 송파구 blocklist, "reported by 2 Kinproof families nearby", is the first piece).
2. **More IoT devices.** Smart speakers, door cameras, smart plugs and appliances join the home hub through their APIs.
3. **Humanoid robot APIs.** Plug in home robots such as Figure, so the same family agent that sends today's robot to
   bring Grandma her pills can drive a humanoid helper, under the same code guardrails (no door, no gas, capped bath temperature).
4. **Proactive family agent.** Reads the shared calendar and reaches out first for low-stakes coordination, never for money.
