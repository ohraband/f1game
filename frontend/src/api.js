async function req(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || JSON.stringify(data));
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  tracks: () => req("/tracks/"),
  races: () => req("/races/"),
  getRace: (id) => req(`/races/${id}/`),
  createRace: (body) => req("/races/", { method: "POST", body }),
  deleteRace: (id) => req(`/races/${id}/`, { method: "DELETE" }),
  addCompetitor: (id, x, y) => req(`/races/${id}/competitors/`, { method: "POST", body: { x, y } }),
  setPlayer: (id, competitor) => req(`/races/${id}/player/`, { method: "POST", body: { competitor } }),
  startRace: (id) => req(`/races/${id}/start/`, { method: "POST" }),
  getReplay: (id) => req(`/races/${id}/replay/`),
};
