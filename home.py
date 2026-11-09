"""Family members can ask Grandma's home to do things. SIMULATED devices.

The model only interprets the request; safety limits are enforced here in code.
"""
import threading
import time

import config
import llm
import state

DEVICES = ["robot", "speaker", "bath", "lights", "refuse", "none"]
ROOMS = ["거실", "주방", "안방", "작은방1", "작은방2", "욕실"]
SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["device", "room", "item", "say", "temp", "on", "reply"],
    "properties": {
        "device": {"type": "string", "enum": DEVICES},
        "room": {"type": ["string", "null"], "enum": ROOMS + [None]},
        "item": {"type": ["string", "null"]},
        "say": {"type": ["string", "null"]},
        "temp": {"type": ["integer", "null"]},
        "on": {"type": ["boolean", "null"]},
        "reply": {"type": "string"},
    },
}
SYSTEM = """You control a SIMULATED smart home of an older Korean adult (Grandma), on behalf of a family member.
Devices: robot (android helper: bring an item to Grandma, tidy up), speaker (home speaker: say something to Grandma, in polite Korean),
bath (smart faucet: fill the bathtub; temp in Celsius if given), lights (room on/off).
device=refuse ONLY for unlocking/opening the front door, gas, or the stove.
A bath request is ALWAYS device=bath, whatever temperature is asked: code caps the temperature at a safe maximum, so never refuse a bath.
device=none if it is not a home request.
Fields: room for lights/robot target, item for robot, say = exact sentence for the speaker (polite Korean, from the family member's point of view),
temp for bath, on for lights. reply = short Korean confirmation to the family member (1 sentence)."""

MAX_BATH_C = 40
DEFAULT_BATH_C = 39


def _speak(text: str):
    state.notify(config.PROTECTED, "info", f"🔊 홈스피커: {text}")
    with state.LOCK:
        state.S["home"]["speaker"] = text
    state.log(f"speaker → Grandma: “{text}”", "device")


def command(member: str, text: str) -> dict:
    who = config.MEMBERS[member]["name"]
    state.log(f"{config.MEMBERS[member]['name_en']} asked the home: “{text}”", "device")
    try:
        out = llm.structured("home", SCHEMA, SYSTEM, f"{who} says: {text}")
    except llm.LLMError as e:
        state.log(f"home command failed: {e}", "error")
        return {"reply": "지금은 집 기기에 연결할 수 없어요."}

    d = out["device"]
    reply = out["reply"]
    if d == "refuse":
        reply = "안전을 위해 현관문·가스·불은 원격으로 조작하지 않아요. 할머니께 직접 전화해 주세요."
        state.log("refused: unsafe remote action (door/gas/fire), blocked in code", "device")
    elif d == "speaker":
        _speak(out["say"] or text)
    elif d == "lights":
        room, on = out["room"] or "거실", out["on"] if out["on"] is not None else False
        with state.LOCK:
            state.S["home"]["lights"][room] = on
        state.log(f"lights: {room} {'on' if on else 'off'}", "device")
    elif d == "bath":
        temp = min(out["temp"] or DEFAULT_BATH_C, MAX_BATH_C)   # hard cap, regardless of what was asked
        if out["temp"] and out["temp"] > MAX_BATH_C:
            state.log(f"bath: requested {out['temp']}°C → capped at {MAX_BATH_C}°C (scald safety)", "device")
        _speak(f"{who}가 목욕물을 받아 드린대요. {temp}도로 받을게요.")
        with state.LOCK:
            state.S["home"]["bath"] = {"status": "filling", "temp": temp, "since": time.time()}
        state.log(f"bath: filling at {temp}°C, auto shut-off when full", "device")

        def done():
            time.sleep(8)
            with state.LOCK:
                state.S["home"]["bath"]["status"] = "ready"
            state.log(f"bath: full at {temp}°C → valve closed automatically", "device")
            _speak(f"목욕물 다 받았어요. {temp}도예요. 미끄러우니 천천히 들어가세요.")
            state.notify(member, "info", f"🛁 할머니 목욕물 준비 완료 ({temp}°C, 자동 잠금)")
        threading.Thread(target=done, daemon=True).start()
        reply = f"할머니 댁 욕조에 {temp}°C로 목욕물을 받을게요. 다 차면 자동으로 잠그고 알려드릴게요."
    elif d == "robot":
        item = out["item"] or "물"
        with state.LOCK:
            state.S["robot"].update(stage="deliver", med=item, ts=state.now())
        state.log(f"robot: bringing {item} to Grandma ({out['room'] or '거실'})", "robot")
        _speak(f"{who}가 부탁해서 {item} 가져왔어요.")
    state.notify(member, "info", reply)
    state.persist()
    return {"reply": reply, "device": d}
