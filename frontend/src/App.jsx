import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import TrackView from "./TrackView.jsx";
import { brakeGuide } from "./guide.js";

// The server pushes ticks at 20 Hz; we draw at display rate by blending between two ticks.
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
};
const mix = (from, to, t) =>
  Object.fromEntries(Object.entries(to).map(([id, b]) => {
    const a = from?.[id] ?? b;
    return [id, [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerpAngle(a[2], b[2], t)]];
  }));

export default function App() {
  const [tracks, setTracks] = useState([]);
  const [races, setRaces] = useState([]);
  const [race, setRace] = useState(null);
  const [live, setLive] = useState(null); // {competitorId: [x, y, angle]} while racing / after a race
  const [replay, setReplay] = useState(null);
  const [playing, setPlaying] = useState(false); // replay running
  const [driving, setDriving] = useState(false); // interactive race running
  const [hud, setHud] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [showGuide, setShowGuide] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", track: "", laps: 3 });
  const raf = useRef(0);
  const driveRef = useRef(false);
  const throttle = useRef(0);
  const wsRef = useRef(null);
  const anim = useRef({ from: null, to: null, t0: 0, dur: 60 }); // current blend between two server ticks
  const shown = useRef(null); // what is currently drawn

  const run = async (fn) => {
    setError("");
    try { return await fn(); } catch (e) { setError(e.message); }
  };
  const refreshList = () => api.races().then(setRaces);

  useEffect(() => {
    run(async () => {
      const t = await api.tracks();
      setTracks(t);
      setForm((f) => ({ ...f, track: t[0]?.key ?? "" }));
      await refreshList();
    });
    return stopAll;
  }, []);

  // Keyboard: Up/W = gas, Down/S = brake. The throttle goes over the WebSocket only when it changes.
  useEffect(() => {
    const keys = new Set();
    const update = () => {
      const gas = keys.has("ArrowUp") || keys.has("w");
      const brake = keys.has("ArrowDown") || keys.has("s");
      const next = brake ? -1 : gas ? 1 : 0;
      if (next === throttle.current) return;
      throttle.current = next;
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ throttle: next }));
    };
    const down = (e) => {
      if (!driveRef.current) return;
      if (e.key.startsWith("Arrow")) e.preventDefault();
      keys.add(e.key); update();
    };
    const up = (e) => { keys.delete(e.key); update(); };
    const blur = () => { keys.clear(); update(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  function stopAll() {
    cancelAnimationFrame(raf.current);
    driveRef.current = false;
    throttle.current = 0;
    wsRef.current?.close();
    wsRef.current = null;
    setPlaying(false); setDriving(false); setLive(null); setHud(null); setCountdown(null);
  }

  const openRace = (id) => run(async () => {
    stopAll();
    setReplay(null);
    setRace(await api.getRace(id));
  });

  const createRace = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api.createRace({ ...form, laps: Number(form.laps) });
      setForm((f) => ({ ...f, name: "" }));
      await refreshList();
      openRace(r.id);
    });
  };

  const removeRace = (id) => run(async () => {
    await api.deleteRace(id);
    if (race?.id === id) { stopAll(); setRace(null); }
    await refreshList();
  });

  const addCar = (x, y) => {
    if (!race || race.status !== "grid") return;
    run(async () => {
      await api.addCompetitor(race.id, x, y);
      setRace(await api.getRace(race.id));
    });
  };

  const toggleDriver = (c) => run(async () => setRace(await api.setPlayer(race.id, c.is_player ? null : c.id)));

  // Replay of a finished race from the server's recorded frames (blended between frames).
  const play = (rep) => {
    setReplay(rep);
    setPlaying(true);
    const at = (fr) => Object.fromEntries(rep.car_ids.map((id, k) => [id, fr[k]]));
    const last = rep.frames.length - 1;
    const t0 = performance.now();
    const tick = (now) => {
      // rAF's timestamp can be slightly *before* t0, so clamp at 0 (a negative index crashed the replay)
      const f = Math.max(0, Math.min(last, (now - t0) / 1000 / rep.dt));
      const i = Math.floor(f);
      setLive(mix(at(rep.frames[i]), at(rep.frames[Math.min(i + 1, last)]), f - i));
      if (f < last) raf.current = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const endDrive = () => {
    if (!driveRef.current) return;
    driveRef.current = false;
    cancelAnimationFrame(raf.current);
    wsRef.current = null;
    setDriving(false);
    setCountdown(null);
  };

  // Interactive race over a WebSocket: the server pushes a tick every 50 ms, we send the
  // throttle when it changes, and a render loop blends between ticks at display rate.
  const drive = (id) => {
    driveRef.current = true;
    setDriving(true);
    setHud(null);
    anim.current = { from: null, to: null, t0: 0, dur: 60 };
    shown.current = null;

    const render = (now) => {
      const { from, to, t0, dur } = anim.current;
      if (to) {
        const s = mix(from, to, Math.max(0, Math.min(1, (now - t0) / dur)));
        shown.current = s;
        setLive(s);
      }
      raf.current = requestAnimationFrame(render);
    };
    raf.current = requestAnimationFrame(render);

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/races/${id}/`);
    wsRef.current = ws;
    let lastArrival = performance.now();

    ws.onopen = () => ws.send(JSON.stringify({ throttle: throttle.current }));
    ws.onerror = () => setError("WebSocket failed. Is the backend running (Daphne / runserver)?");
    ws.onclose = () => endDrive();
    ws.onmessage = async (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === "countdown") return setCountdown(m.n);
      if (m.type === "error") { setError(m.detail); ws.close(); return; }
      setCountdown(null);
      const now = performance.now();
      const to = Object.fromEntries(m.cars.map((c) => [c.id, [c.x, c.y, c.angle]]));
      anim.current = { from: shown.current ?? to, to, t0: now, dur: Math.min(120, Math.max(30, now - lastArrival)) };
      lastArrival = now;
      setHud({ ...m.player, cars: m.cars.length });
      if (m.type === "finished") {
        ws.close();
        await run(async () => {
          setRace(await api.getRace(id));
          setReplay(await api.getReplay(id));
          refreshList();
        });
        setLive(to);
      }
    };
  };

  const startRace = () => run(async () => {
    const updated = await api.startRace(race.id);
    setRace(updated);
    refreshList();
    if (updated.status === "running") drive(updated.id);
    else play(await api.getReplay(updated.id));
  });

  const watchReplay = () => run(async () => play(replay ?? (await api.getReplay(race.id))));

  const track = race && tracks.find((t) => t.key === race.track);
  const guide = useMemo(
    () => (driving && showGuide && track && race ? brakeGuide(track, hud, race.laps) : null),
    [driving, showGuide, track, race?.laps, hud],
  );
  const cars = race?.competitors.map((c) => {
    const [x, y, angle] = live?.[c.id] ?? [c.grid_x, c.grid_y, c.grid_angle];
    return { id: c.id, color: c.color, slot: c.grid_slot, player: c.is_player, x, y, angle };
  }) ?? [];
  const results = race?.competitors
    .filter((c) => c.finish_position)
    .sort((a, b) => a.finish_position - b.finish_position);
  const busy = playing || driving;
  const braking = guide ? guide.urgent : hud && hud.limit_ahead < hud.speed * 1.05;

  return (
    <div className="app">
      <aside>
        <h1>Mini F1</h1>
        <form onSubmit={createRace}>
          <input placeholder="Race name" required value={form.name}
                 onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select value={form.track} onChange={(e) => setForm({ ...form, track: e.target.value })}>
            {tracks.map((t) => <option key={t.key} value={t.key}>{t.name} ({t.country})</option>)}
          </select>
          <label>Laps <input type="number" min="1" max="10" value={form.laps}
                             onChange={(e) => setForm({ ...form, laps: e.target.value })} /></label>
          <button>Create race</button>
        </form>
        <ul className="races">
          {races.map((r) => (
            <li key={r.id} className={race?.id === r.id ? "active" : ""}>
              <button className="link" onClick={() => openRace(r.id)}>
                {r.name}<small>{r.track} · {r.status === "finished" ? `🏆 ${r.winner}` : r.status}</small>
              </button>
              <button className="x" title="Delete" onClick={() => removeRace(r.id)}>×</button>
            </li>
          ))}
        </ul>
      </aside>

      <main>
        {error && <div className="error" onClick={() => setError("")}>{error}</div>}
        {!race && <p className="hint">Create or pick a race to begin.</p>}
        {race && track && (
          <>
            <header>
              <h2>{race.name} <small>{track.name} · {race.laps} laps</small></h2>
              {race.status === "grid" && (
                <button disabled={race.competitors.length < 2 || busy} onClick={startRace}>
                  Start race ({race.competitors.length} on grid)
                </button>
              )}
              {race.status === "running" && !driving && <button onClick={() => drive(race.id)}>Resume driving</button>}
              {race.status === "finished" && <button disabled={busy} onClick={watchReplay}>Watch replay</button>}
            </header>

            <TrackView track={track} cars={cars} onTrackClick={addCar} heat={showGuide} guide={guide}>
              {countdown && <div className="countdown" key={countdown}>{countdown}</div>}
            </TrackView>

            <div className="legend">
              <label><input type="checkbox" checked={showGuide} onChange={(e) => setShowGuide(e.target.checked)} /> Braking guide</label>
              {showGuide && (
                <>
                  <span>slow corner</span><i className="grad" /><span>flat out</span>
                  <span className="note">Yellow line = start braking here (moves with your speed). Red zone = keep braking until the corner.</span>
                </>
              )}
            </div>

            {driving && hud && (
              <div className="hud">
                <span>P<b>{hud.position}</b>/{hud.cars}</span>
                <span>Lap <b>{hud.lap}</b>/{race.laps}</span>
                <span><b>{hud.speed}</b> km/h</span>
                <div className="bar" title="Yellow mark = safe speed for the corner ahead">
                  <div className={`fill ${braking ? "hot" : ""}`} style={{ width: `${Math.min(100, (hud.speed / 270) * 100)}%` }} />
                  <div className="mark" style={{ left: `${(hud.limit_ahead / 270) * 100}%` }} />
                </div>
                <span className="warn">{hud.off_track ? "OFF TRACK!" : braking ? "BRAKE!" : ""}</span>
              </div>
            )}
            {driving && <p className="hint">↑ / W = gas, ↓ / S = brake. Be below the yellow mark when you reach the corner.</p>}

            {race.status === "grid" && (
              <>
                <p className="hint">Click the track to add a car (max 10). Pick one to drive yourself, or none to watch the AI.</p>
                <div className="grid-list">
                  {race.competitors.map((c) => (
                    <div key={c.id} className="chip">
                      <span className="dot" style={{ background: c.color }} />{c.name}
                      <button className={c.is_player ? "on" : ""} onClick={() => toggleDriver(c)}>
                        {c.is_player ? "🎮 You" : "Drive"}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {race.status === "finished" && !busy && (
              <table>
                <thead><tr><th>Pos</th><th>Driver</th><th>Pace</th><th>Time</th></tr></thead>
                <tbody>
                  {results.map((c) => (
                    <tr key={c.id}>
                      <td>{c.finish_position}</td>
                      <td><span className="dot" style={{ background: c.color }} />{c.name}{c.is_player ? " 🎮" : ""}</td>
                      <td>{c.pace}</td>
                      <td>{c.finish_time != null ? `${c.finish_time.toFixed(2)}s` : "DNF"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </main>
    </div>
  );
}
