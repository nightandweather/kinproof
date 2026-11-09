# Kinproof

**Voice isn't proof anymore. Family is.**

Kinproof syncs a family's AI conversations (ChatGPT, Claude, local models, voice notes) into a private,
consent-based **family wiki**. The same wiki coordinates care for an older family member and protects them
from voice-clone scams in real time.

Built at c0mpiled-17 Seoul for YC RFS *AI for the Aging Population* × *Proving You're Human*.

## Run
```bash
pip install -r requirements.txt
cp .env.example .env   # add OPENAI_API_KEY and model names
uvicorn server:app --port 8000
# open http://localhost:8000 in Chrome (Web Speech)
```
