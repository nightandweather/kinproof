"""OpenAI Structured Outputs wrapper with a record/replay cache.

Every successful response is cached under data/cache/ keyed by
(model, schema name, prompts). In replay mode the same code path reads the
cache instead of the network, so demos survive bad venue Wi-Fi while still
showing real model output from an earlier live run.
"""
import hashlib
import json
import os

import config


class LLMError(Exception):
    pass


_client = None


def _get_client():
    global _client
    if _client is None:
        from openai import OpenAI
        _client = OpenAI(timeout=config.LLM_TIMEOUT, max_retries=1)
    return _client


def _cache_path(name: str, model: str, system: str, user: str):
    key = hashlib.sha256(
        json.dumps([model, name, system, user], ensure_ascii=False).encode()
    ).hexdigest()[:24]
    return config.CACHE_DIR / f"{name}-{key}.json"


def _live_available() -> bool:
    return bool(os.getenv("OPENAI_API_KEY")) and bool(config.MODEL_FAST)


def structured(name: str, schema: dict, system: str, user: str, model: str | None = None) -> dict:
    model = model or config.MODEL_FAST
    path = _cache_path(name, model, system, user)

    # cache  = cache-first: reuse a recorded answer if there is one, otherwise call live and record it.
    #          Keeps a demo chain deterministic: the same inputs always get the same outputs.
    # replay = cache only (offline); live = always call; record = always call and overwrite.
    if config.LLM_MODE in ("cache", "replay") and path.exists():
        return json.loads(path.read_text())["output"]
    if config.LLM_MODE == "replay" and not _live_available():
        raise LLMError(f"replay cache miss: {path.name}")

    if not _live_available():
        raise LLMError("OPENAI_API_KEY or KP_MODEL_FAST is not set")

    try:
        resp = _get_client().chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": name, "schema": schema, "strict": True},
            },
        )
        msg = resp.choices[0].message
        if getattr(msg, "refusal", None):
            raise LLMError(f"model refused: {msg.refusal}")
        output = json.loads(msg.content)
    except LLMError:
        raise
    except Exception as e:  # network, timeout, bad JSON
        raise LLMError(f"{type(e).__name__}: {e}") from e

    path.write_text(json.dumps({"model": model, "output": output}, ensure_ascii=False, indent=1))
    return output
