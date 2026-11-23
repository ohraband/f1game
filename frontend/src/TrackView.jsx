import { memo, useMemo, useRef } from "react";

const DEG = 180 / Math.PI;
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const rng = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

// Static scenery in its own SVG: it is drawn once and never repainted while cars move.
const Scenery = memo(function Scenery({ track, heat }) {
  const d = "M" + track.path.map((p) => p.join(",")).join(" L") + " Z";
  const { x, y, angle } = track.start;
  const w = track.width;

  const trees = useMemo(() => {
    const rand = rng(hash(track.key));
    const out = [];
    for (let i = 0; i < 900 && out.length < 150; i++) {
      const tx = 15 + rand() * 970, ty = 15 + rand() * 570, r = 7 + rand() * 9;
      let min = Infinity;
      for (const [px, py] of track.path) min = Math.min(min, Math.hypot(tx - px, ty - py));
      if (min > w / 2 + 38 + r) out.push({ tx, ty, r });
    }
    return out;
  }, [track]);

  // Corner-speed heat map: red = slow corner, green = flat out.
  const heatSegs = useMemo(() => track.path.map((p, i) => {
    const q = track.path[(i + 1) % track.path.length];
    const hue = Math.max(0, Math.min(120, ((track.safe[i] - 160) / 177) * 120));
    return { p, q, color: `hsl(${hue} 90% 50%)` };
  }), [track]);

  const rows = Math.round(w / 6);
  return (
    <svg viewBox="0 0 1000 600" className="layer">
      <defs>
        <pattern id="mow" width="70" height="70" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <rect width="70" height="70" fill="#2b5d2f" />
          <rect width="35" height="70" fill="#32693a" />
        </pattern>
        <pattern id="crowd" width="7" height="7" patternUnits="userSpaceOnUse">
          <rect width="7" height="7" fill="#454b57" />
          <circle cx="2" cy="2" r="1.3" fill="#e8484c" /><circle cx="5.5" cy="3.5" r="1.3" fill="#f4d35e" />
          <circle cx="3" cy="5.8" r="1.3" fill="#4ea8de" />
        </pattern>
        <radialGradient id="vig" cx="50%" cy="50%" r="75%">
          <stop offset="60%" stopColor="#000" stopOpacity="0" /><stop offset="100%" stopColor="#000" stopOpacity="0.5" />
        </radialGradient>
        <filter id="grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 -0.12" />
        </filter>
        <filter id="soft"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>

      <rect width="1000" height="600" fill="url(#mow)" />
      <rect width="1000" height="600" filter="url(#grain)" opacity="0.5" />

      {trees.map((t, i) => (
        <g key={i}>
          <circle cx={t.tx + 3} cy={t.ty + 4} r={t.r} fill="#0b2410" opacity="0.45" />
          <circle cx={t.tx} cy={t.ty} r={t.r} fill="#1f4d27" />
          <circle cx={t.tx - t.r * 0.25} cy={t.ty - t.r * 0.3} r={t.r * 0.6} fill="#2f7a3a" />
        </g>
      ))}

      {/* runoff: gravel trap, then a soft shadow under the asphalt */}
      <path d={d} fill="none" stroke="#b9a676" strokeWidth={w + 56} strokeLinejoin="round" opacity="0.9" />
      <path d={d} fill="none" stroke="#8fcf7a" strokeWidth={w + 44} strokeLinejoin="round" opacity="0.0" />
      <path d={d} fill="none" stroke="#d7c795" strokeWidth={w + 40} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#000" strokeWidth={w + 12} strokeLinejoin="round" opacity="0.35" filter="url(#soft)" />
      {/* kerbs: white base with red dashes on top */}
      <path d={d} fill="none" stroke="#f2f2f2" strokeWidth={w + 10} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#d62f23" strokeWidth={w + 10} strokeLinejoin="round" strokeDasharray="9 9" />
      {/* asphalt, then the darker racing line */}
      <path d={d} fill="none" stroke="#35383e" strokeWidth={w} strokeLinejoin="round" />
      {heat ? (
        <g strokeWidth={w * 0.62} strokeLinecap="round" opacity="0.62">
          {heatSegs.map((s, i) => <line key={i} x1={s.p[0]} y1={s.p[1]} x2={s.q[0]} y2={s.q[1]} stroke={s.color} />)}
        </g>
      ) : (
        <path d={d} fill="none" stroke="#2a2c31" strokeWidth={w * 0.4} strokeLinejoin="round" opacity="0.7" />
      )}
      <path d={d} fill="none" stroke="#ffffff" strokeWidth="1.2" strokeDasharray="14 14" opacity="0.28" />

      {/* start / finish: chequered line and a grandstand on the outside */}
      <g transform={`translate(${x},${y}) rotate(${angle * DEG})`}>
        {Array.from({ length: rows * 2 }, (_, i) => (
          <rect key={i} x={(i % 2) * 5 - 5} y={-w / 2 + Math.floor(i / 2) * (w / rows)} width="5" height={w / rows}
                fill={(Math.floor(i / 2) + (i % 2)) % 2 ? "#111" : "#fff"} />
        ))}
        <rect x="-60" y={w / 2 + 28} width="120" height="18" rx="3" fill="url(#crowd)" stroke="#222" strokeWidth="1.5" />
        <rect x="-60" y={w / 2 + 22} width="120" height="6" rx="2" fill="#c0392b" />
      </g>
      <rect width="1000" height="600" fill="url(#vig)" />
    </svg>
  );
});

function Car({ c }) {
  const rot = `rotate(${c.angle * DEG})`;
  return (
    <>
      <g transform={`translate(${c.x + 2},${c.y + 3}) ${rot}`} opacity="0.4">
        <rect x="-12" y="-6.5" width="24" height="13" rx="4" fill="#000" />
      </g>
      <g transform={`translate(${c.x},${c.y}) ${rot}`}>
        {c.player && <circle r="17" fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="5 4" opacity="0.9" />}
        {[[-9, -7], [-9, 4], [5, -6.5], [5, 3.5]].map(([wx, wy], i) => (
          <rect key={i} x={wx} y={wy} width="5.5" height="3" rx="0.8" fill="#111" />
        ))}
        <rect x="-12" y="-5.5" width="3" height="11" fill="#222" />
        <rect x="9.5" y="-5.5" width="2.5" height="11" fill={c.color} stroke="#111" strokeWidth="0.6" />
        <path d="M-9,-3 L3,-3 L11,-1 L11,1 L3,3 L-9,3 Z" fill={c.color} stroke="#111" strokeWidth="0.7" />
        <rect x="-6" y="-4.2" width="8" height="8.4" rx="2" fill={c.color} stroke="#111" strokeWidth="0.6" />
        <circle cx="-1" cy="0" r="2.1" fill="#f5f5f5" stroke="#111" strokeWidth="0.5" />
      </g>
      <text x={c.x} y={c.y - 14} fontSize="9" fontWeight="700" textAnchor="middle" fill="#fff"
            stroke="#000" strokeWidth="2.5" paintOrder="stroke">
        {c.player ? "YOU" : c.slot + 1}
      </text>
    </>
  );
}

function BrakeGuide({ guide, width }) {
  const { marker: m, zone, urgent, target } = guide;
  const color = urgent ? "#ff2a1f" : "#ffd000";
  return (
    <g>
      <polyline points={zone.map((p) => p.join(",")).join(" ")} fill="none" stroke="#ff2a1f"
                strokeOpacity={urgent ? 0.55 : 0.35} strokeWidth={width} strokeLinejoin="round" />
      <g transform={`translate(${m.x},${m.y}) rotate(${m.angle * DEG})`}>
        <rect x="-3" y={-width / 2 - 5} width="6" height={width + 10} fill={color} stroke="#000" strokeWidth="1" />
        <path d={`M-14,${-width / 2 - 5} l8,-7 l8,7 z M-14,${width / 2 + 5} l8,7 l8,-7 z`} fill={color} />
      </g>
      <text x={m.x + Math.cos(m.angle - Math.PI / 2) * (width / 2 + 22)} y={m.y + Math.sin(m.angle - Math.PI / 2) * (width / 2 + 22) + 4}
            fontSize="12" fontWeight="800" textAnchor="middle" fill={color} stroke="#000" strokeWidth="3" paintOrder="stroke">
        {urgent ? "BRAKE" : "brake"} → {target}
      </text>
    </g>
  );
}

export default function TrackView({ track, cars, onTrackClick, heat = true, guide = null, children }) {
  const svg = useRef(null);
  const handleClick = (e) => {
    const pt = svg.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.current.getScreenCTM().inverse());
    onTrackClick(p.x, p.y);
  };
  return (
    <div className="stage">
      <Scenery track={track} heat={heat} />
      <svg ref={svg} viewBox="0 0 1000 600" className="layer cars" onClick={handleClick}>
        {guide && <BrakeGuide guide={guide} width={track.width} />}
        {cars.map((c) => <Car key={c.id} c={c} />)}
      </svg>
      {children}
    </div>
  );
}
