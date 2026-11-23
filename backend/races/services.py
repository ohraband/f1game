"""Race engine: one tick = DT seconds. The same `_advance` drives AI-only races
(looped to the end at once) and interactive ones (one tick per API call)."""
import random

from django.db import transaction

from .models import Race
from .tracks import get_track

GRID_GAP = 18      # distance between grid slots
BASE_SPEED = 220   # AI cruising speed (canvas units / s)
MAX_PLAYER = 255   # player top speed (a bit faster than AI on straights)
ACCEL, BRAKE, DRAG = 150, 320, 0.2
PLAYER_GRIP = 1.25  # the player's safe corner speed vs the AI's limit (shown in the HUD)
SPIN_MARGIN = 1.15  # spin only when this far above the safe speed
DT = 0.05          # tick length (s) = websocket push rate (20 Hz)
MAX_TIME = 300     # safety cap (s)
SLOW_TICKS = round(1.5 / DT)  # how long an AI spin lasts
PLAYER_SPIN_TIME = 3.0        # seconds a player spin lasts at minimum; more if you were far over the limit
AI_MISTAKE_CHANCE = 0.5       # chance per braking zone that an AI car brakes too late and spins

DRIVERS = [
    ("Scarlet", "#e10600"), ("Papaya", "#ff8000"), ("Silver", "#c0c7cf"), ("Teal", "#00c2a8"),
    ("Navy", "#2f5bff"), ("Lime", "#9be000"), ("Violet", "#9b51e0"), ("Pink", "#ff5fa2"),
    ("Gold", "#ffd000"), ("White", "#ffffff"),
]
MAX_CARS = len(DRIVERS)


def new_car_attrs(slot):
    name, color = DRIVERS[slot]
    return {"name": f"{name} #{slot + 1}", "color": color, "pace": round(random.uniform(0.97, 1.03), 3)}


def _snapshot(state, cars, track):
    out = []
    for c in cars:
        x, y, a = track.point_at(state["cars"][str(c.id)]["d"])
        out.append([round(x, 1), round(y, 1), round(a, 2)])
    return out


def _all_done(state):
    return all(st["fin"] is not None for st in state["cars"].values()) or state["t"] >= MAX_TIME


def _advance(race, cars, track, throttle):
    """Move every car one tick. Player speed comes from `throttle`; AI follows corner limits."""
    s = race.state
    total = race.laps * track.length
    s["t"] = round(s["t"] + DT, 2)
    for c in cars:
        st = s["cars"][str(c.id)]
        if st["fin"] is not None:
            continue
        limit = track.limit_at(st["d"])
        if c.is_player:
            v = st["v"] + (ACCEL * throttle if throttle > 0 else BRAKE * throttle) * DT
            v = max(0.0, min(v - DRAG * v * DT, MAX_PLAYER * c.pace))
            if st["slow"] > 0:             # recovering from a spin: crawl
                st["slow"] -= 1
                v = min(v, limit * 0.5)
            elif v > limit * PLAYER_GRIP * SPIN_MARGIN:
                # too fast into the corner: full stop, then a long crawl. The further over the limit, the longer.
                over = min(2.0, v / (limit * PLAYER_GRIP * SPIN_MARGIN))
                v, st["slow"] = 0.0, round((PLAYER_SPIN_TIME + 4.0 * (over - 1)) / DT)
        else:
            # AI looks ahead and brakes at the same rate the player can, so it can't teleport to corner speed
            target = min(BASE_SPEED * c.pace * random.uniform(0.92, 1.08), track.limit_ahead(st["d"], 80))
            if st["slow"] > 0:             # recovering from a spin
                st["slow"] -= 1
                target = min(target, limit * 0.6)
            elif target < st["v"] - 5:     # braking zone: roll once when it starts
                if not st.get("brk") and random.random() < AI_MISTAKE_CHANCE:
                    # braked too late: spin, same penalty as the player gets (random severity)
                    st["v"] = 0.0
                    st["slow"] = round(SLOW_TICKS * random.uniform(1.0, 2.5))
                st["brk"] = True
            else:
                st["brk"] = False
            v = min(target, st["v"] + ACCEL * DT) if st["v"] < target else max(target, st["v"] - BRAKE * DT)
        prev = st["d"]
        st["d"], st["v"] = prev + v * DT, v
        if st["d"] >= total:
            st["fin"] = round(s["t"] - DT + DT * (total - prev) / (v * DT), 2)
            st["d"] = total
    s["frames"].append(_snapshot(s, cars, track))


def _finish(race, cars):
    s = race.state
    with transaction.atomic():
        ranked = sorted(cars, key=lambda c: (s["cars"][str(c.id)]["fin"] is None,
                                             s["cars"][str(c.id)]["fin"] or 0))
        for pos, c in enumerate(ranked, start=1):
            c.finish_position = pos
            c.finish_time = s["cars"][str(c.id)]["fin"]
        race.competitors.bulk_update(cars, ["finish_position", "finish_time"])
        race.replay = {"dt": DT, "car_ids": [c.id for c in cars], "frames": s["frames"]}
        race.state, race.status = None, Race.Status.FINISHED
        race.save(update_fields=["replay", "state", "status"])


def start_race(race):
    """Grid -> running. Without a human driver the whole race is simulated immediately."""
    track = get_track(race.track)
    cars = list(race.competitors.all())
    race.state = {"t": 0.0, "frames": [], "cars": {
        str(c.id): {"d": -GRID_GAP * (c.grid_slot + 1), "v": 0.0, "slow": 0, "fin": None} for c in cars}}
    race.state["frames"].append(_snapshot(race.state, cars, track))
    race.status = Race.Status.RUNNING
    if any(c.is_player for c in cars):
        race.save(update_fields=["state", "status"])
        return
    while not _all_done(race.state):
        _advance(race, cars, track, 0)
    _finish(race, cars)


def _payload(race, track, cars, done):
    s = race.state
    total = race.laps * track.length

    def order_key(c):
        st = s["cars"][str(c.id)]
        return (0, st["fin"]) if st["fin"] is not None else (1, -st["d"])

    position = {c.id: i + 1 for i, c in enumerate(sorted(cars, key=order_key))}
    lap = lambda d: min(race.laps, max(1, int(d // track.length) + 1))
    out, player = [], None
    for c in cars:
        st = s["cars"][str(c.id)]
        x, y, a = track.point_at(st["d"])
        out.append({"id": c.id, "x": round(x, 1), "y": round(y, 1), "angle": round(a, 2),
                    "lap": lap(st["d"]), "position": position[c.id]})
        if c.is_player:
            player = {"id": c.id, "speed": round(st["v"]), "limit": round(track.limit_at(st["d"]) * PLAYER_GRIP),
                      "limit_ahead": round(track.limit_ahead(st["d"]) * PLAYER_GRIP), "lap": lap(st["d"]),
                      "position": position[c.id], "off_track": st["slow"] > 0,
                      "finished": st["fin"] is not None, "progress": round(st["d"] / total, 3)}
    return {"t": s["t"], "finished": done, "cars": out, "player": player}


def tick(race, cars, track, throttle):
    """One interactive tick, fully in memory (no DB). Returns (payload, done).
    When the human finishes, the rest of the field is run out so results are complete."""
    _advance(race, cars, track, throttle)
    player = next(c for c in cars if c.is_player)
    if race.state["cars"][str(player.id)]["fin"] is not None:
        while not _all_done(race.state):
            _advance(race, cars, track, 0)
    done = _all_done(race.state)
    return _payload(race, track, cars, done), done


def finish_race(race, cars):
    _finish(race, cars)


def save_state(race):
    race.save(update_fields=["state"])
