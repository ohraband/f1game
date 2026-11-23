"""Live race over a WebSocket: ws://host/ws/races/<id>/

client -> server   {"throttle": -1..1}                       (sent only when a key changes)
server -> client   {"type": "countdown", "n": 3}              (before the start)
                   {"type": "tick", "t", "cars", "player"}    (every DT seconds)
                   {"type": "finished", ...last tick...}      (race over, results saved)
                   {"type": "error", "detail": "..."}
The race runs in memory in a per-connection asyncio task; the DB is touched only
when loading, when the race finishes, and when the player disconnects mid-race.
"""
import asyncio
import time

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .models import Race
from .services import DT, finish_race, save_state, tick
from .tracks import get_track

ACTIVE = set()  # race ids currently being driven (one driver per race)


class RaceConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.race_id = int(self.scope["url_route"]["kwargs"]["race_id"])
        self.task, self.throttle, self.registered = None, 0.0, False
        await self.accept()
        if self.race_id in ACTIVE:
            return await self._reject("This race is already being driven.")
        if not await self._load():
            return await self._reject("Race is not running or has no player car.")
        ACTIVE.add(self.race_id)
        self.registered = True
        self.task = asyncio.create_task(self._run())

    @database_sync_to_async
    def _load(self):
        race = Race.objects.filter(pk=self.race_id).first()
        if race is None or race.status != Race.Status.RUNNING:
            return False
        cars = list(race.competitors.all())
        if not any(c.is_player for c in cars):
            return False
        self.race, self.cars, self.track = race, cars, get_track(race.track)
        return True

    async def _reject(self, detail):
        await self.send_json({"type": "error", "detail": detail})
        await self.close(code=4000)

    async def receive_json(self, content, **kwargs):
        try:
            self.throttle = max(-1.0, min(1.0, float(content.get("throttle", 0))))
        except (TypeError, ValueError):
            pass

    async def _run(self):
        if len(self.race.state["frames"]) <= 1:  # fresh start (not a resume): lights out
            for n in (3, 2, 1):
                await self.send_json({"type": "countdown", "n": n})
                await asyncio.sleep(1)
        next_t = time.perf_counter()
        while True:
            payload, done = tick(self.race, self.cars, self.track, self.throttle)
            if done:
                await database_sync_to_async(finish_race)(self.race, self.cars)
                await self.send_json({"type": "finished", **payload})
                await self.close()
                return
            await self.send_json({"type": "tick", **payload})
            next_t += DT
            now = time.perf_counter()
            if next_t < now - 0.5:      # we fell far behind (slow client): don't try to catch up
                next_t = now
            await asyncio.sleep(max(0.0, next_t - now))

    async def disconnect(self, code):
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
        if self.registered:
            ACTIVE.discard(self.race_id)
            if self.race.status == Race.Status.RUNNING:  # left mid-race: keep it resumable
                await database_sync_to_async(save_state)(self.race)
