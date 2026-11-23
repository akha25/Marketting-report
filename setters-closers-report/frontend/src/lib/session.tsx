import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";
import type { Health, Preview, SessionInfo, Settings, View } from "./types";
import { defaultSlot, todayIST } from "./util";

interface Ctx {
  date: string;
  slot: string;
  setDate: (d: string) => void;
  setSlot: (s: string) => void;
  settings: Settings | null;
  setSettings: (s: Settings) => void;
  health: Health | null;
  session: SessionInfo | null;
  preview: Preview | null;
  view: View | null;
  loading: boolean;
  error: string | null;
  /** Replace the preview with a server response and refresh the report view. */
  apply: (p: Preview) => Promise<void>;
  reload: () => Promise<void>;
}

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem("report-session") || "null"); } catch { return null; } })();
  const [date, setDate] = useState<string>(saved?.date ?? todayIST());
  const [slot, setSlot] = useState<string>(saved?.slot ?? "");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.settings(), api.health()])
      .then(([s, h]) => {
        setSettings(s);
        setHealth(h);
        setSlot((cur) => cur || defaultSlot(s.slots));
      })
      .catch((e) => setError(`Cannot reach the server: ${e.message}`));
  }, []);

  const load = useCallback(async (sid: number) => {
    const [p, v] = await Promise.all([api.preview(sid), api.view(sid)]);
    setPreview(p);
    setSession(p.session);
    setView(v);
  }, []);

  useEffect(() => {
    if (!slot || !date) return;
    try { sessionStorage.setItem("report-session", JSON.stringify({ date, slot })); } catch { /* storage unavailable */ }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.openSession(date, slot)
      .then(async (s) => { if (!cancelled) { setSession(s); await load(s.id); } })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [date, slot, load]);

  const apply = useCallback(async (p: Preview) => {
    setPreview(p);
    setSession(p.session);
    setView(await api.view(p.session.id));
  }, []);

  const reload = useCallback(async () => { if (session) await load(session.id); }, [session, load]);

  return (
    <SessionCtx.Provider value={{ date, slot, setDate, setSlot, settings, setSettings, health, session, preview, view, loading, error, apply, reload }}>
      {children}
    </SessionCtx.Provider>
  );
}

export function useSession(): Ctx {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession outside provider");
  return c;
}
