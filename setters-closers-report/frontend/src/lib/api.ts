import type { AgentInfo, Comparison, Health, Kind, Preview, SessionInfo, Settings, SnapshotMeta, View, Report } from "./types";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body && !(init.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const r = await fetch(BASE + path, { credentials: "include", ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const j = await r.json();
      if (j.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  health: () => req<Health>("/api/health"),
  settings: () => req<Settings>("/api/settings"),
  saveSettings: (s: Settings) => req<Settings>("/api/settings", { method: "PUT", body: json(s) }),
  resetSettings: () => req<Settings>("/api/settings/reset", { method: "POST" }),
  agents: () => req<AgentInfo[]>("/api/agents"),
  updateAgent: (id: number, body: Partial<{ name: string; email: string; role: string | null }>) =>
    req(`/api/agents/${id}`, { method: "PATCH", body: json(body) }),
  openSession: (date: string, slot: string) => req<SessionInfo>("/api/sessions", { method: "POST", body: json({ date, slot }) }),
  preview: (sid: number) => req<Preview>(`/api/sessions/${sid}`),
  view: (sid: number) => req<View>(`/api/sessions/${sid}/view`),
  upload: async (sid: number, kind: Kind, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<{ duplicate_of_current: boolean; preview: Preview }>(`/api/sessions/${sid}/uploads/${kind}`, { method: "POST", body: fd });
  },
  process: (sid: number) => req<Preview>(`/api/sessions/${sid}/process`, { method: "POST" }),
  reextract: (uid: number, provider?: string) =>
    req<Preview>(`/api/uploads/${uid}/extract${provider ? `?provider=${provider}` : ""}`, { method: "POST" }),
  patchUpload: (uid: number, body: Record<string, unknown>) => req<Preview>(`/api/uploads/${uid}`, { method: "PATCH", body: json(body) }),
  decide: (sid: number, body: Record<string, unknown>) => req<Preview>(`/api/sessions/${sid}/matches`, { method: "PATCH", body: json(body) }),
  reset: (sid: number) => req<Preview>(`/api/sessions/${sid}/reset`, { method: "POST" }),
  finalize: (sid: number) => req<{ snapshot_id: number; version: number; report: Report }>(`/api/sessions/${sid}/finalize`, { method: "POST" }),
  snapshots: (params: Record<string, string | boolean | undefined>) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== "" && v !== false) q.set(k, String(v)); });
    return req<SnapshotMeta[]>(`/api/snapshots?${q}`);
  },
  snapshot: (id: number) => req<{ id: number; report: Report }>(`/api/snapshots/${id}`),
  compare: (a: number, b: number) => req<Comparison>(`/api/compare?a=${a}&b=${b}`),
  fileUrl: (uid: number) => `${BASE}/api/uploads/${uid}/file`,
  snapshotExport: (id: number, fmt: "csv" | "xlsx") => `${BASE}/api/snapshots/${id}/export.${fmt}`,
  sessionExport: (sid: number, fmt: "csv" | "xlsx") => `${BASE}/api/sessions/${sid}/export.${fmt}`,
};
