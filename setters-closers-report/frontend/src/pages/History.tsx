import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, X } from "lucide-react";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import type { Comparison, Report, SnapshotMeta } from "../lib/types";
import { classNames, fmtDate, fmtDateTime, fmtNumber } from "../lib/util";
import ExportActions from "../components/ExportActions";
import ReportCanvas from "../components/ReportCanvas";
import { Page } from "./ReportPages";

export default function History() {
  const { settings, date } = useSession();
  const [filters, setFilters] = useState({ date_from: "", date_to: "", slot: "", role: "", agent: "", all_versions: false });
  const [list, setList] = useState<SnapshotMeta[]>([]);
  const [all, setAll] = useState<SnapshotMeta[]>([]);
  const [open, setOpen] = useState<{ id: number; report: Report } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.snapshots(filters).then(setList).catch((e) => setErr(e.message)); }, [filters]);
  useEffect(() => { api.snapshots({}).then(setAll).catch(() => undefined); }, [open]);

  const set = (k: string, v: string | boolean) => setFilters((f) => ({ ...f, [k]: v }));
  return (
    <Page title="Historical Reports">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div><label className="label">From</label><input type="date" className="input" value={filters.date_from} onChange={(e) => set("date_from", e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={filters.date_to} onChange={(e) => set("date_to", e.target.value)} /></div>
        <div><label className="label">Session</label>
          <select className="input" value={filters.slot} onChange={(e) => set("slot", e.target.value)}>
            <option value="">All sessions</option>{settings?.slots.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select></div>
        <div><label className="label">Setter / Closer</label>
          <select className="input" value={filters.role} onChange={(e) => set("role", e.target.value)}>
            <option value="">Both</option><option value="setter">Setters</option><option value="closer">Closers</option>
          </select></div>
        <div><label className="label">Agent name</label><input className="input" placeholder="Search…" value={filters.agent} onChange={(e) => set("agent", e.target.value)} /></div>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-600"><input type="checkbox" checked={filters.all_versions} onChange={(e) => set("all_versions", e.target.checked)} />Show earlier versions</label>
      </div>
      {err && <div className="text-sm text-red-700">{err}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full text-left">
          <thead><tr>{["Date", "Session", "Version", "Generated", "Setters", "Closers", "Bookings", "Source files", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={9} className="td py-8 text-center text-slate-500">No generated reports match these filters.</td></tr>}
            {list.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="td font-medium">{fmtDate(s.date)}</td>
                <td className="td">{s.slot_label}</td>
                <td className="td">v{s.version}{!s.latest && <span className="ml-1 text-xs text-slate-400">(superseded)</span>}</td>
                <td className="td text-slate-600">{fmtDateTime(s.generated_at)}</td>
                <td className="td tabular-nums">{s.setters}</td>
                <td className="td tabular-nums">{s.closers}</td>
                <td className="td tabular-nums">{s.total_bookings ?? "N/A"}</td>
                <td className="td max-w-xs truncate text-xs text-slate-500" title={s.files.map((f) => `${f.label}: ${f.filename}`).join("\n")}>{s.files.map((f) => f.filename).join(", ")}</td>
                <td className="td text-right">
                  <div className="flex justify-end gap-1.5">
                    <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => api.snapshot(s.id).then(setOpen)}>Open</button>
                    <a className="btn-ghost px-2 py-1 text-xs" href={api.snapshotExport(s.id, "csv")}>CSV</a>
                    <a className="btn-ghost px-2 py-1 text-xs" href={api.snapshotExport(s.id, "xlsx")}>Excel</a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ComparePanel snaps={all} today={date} />
      {open && <SnapshotModal snap={open} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function SnapshotModal({ snap, onClose }: { snap: { id: number; report: Report }; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="fixed inset-0 z-40 flex justify-center overflow-y-auto bg-slate-900/50 p-6" onClick={onClose}>
      <div className="h-fit rounded-xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-4">
          <ExportActions report={snap.report} canvas={ref} snapshotId={snap.id} />
          <button className="btn-ghost" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200"><ReportCanvas ref={ref} report={snap.report} /></div>
      </div>
    </div>
  );
}

function ComparePanel({ snaps, today }: { snaps: SnapshotMeta[]; today: string }) {
  const [a, setA] = useState<number | "">("");
  const [b, setB] = useState<number | "">("");
  const [res, setRes] = useState<Comparison | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const byDateSlot = useMemo(() => new Map(snaps.map((s) => [`${s.date} ${s.slot}`, s])), [snaps]);

  useEffect(() => {
    if (a === "" || b === "") return;
    setErr(null);
    api.compare(a, b).then((r) => {
      setRes(r);
      setKeys((k) => (k.length ? k : r.metrics.filter((m) => ["bookings", "talk_time", "host_time", "total_calls"].includes(m.key)).map((m) => m.key)));
    }).catch((e) => setErr(e.message));
  }, [a, b]);

  const quick = (x: string, y: string, d1 = today, d2 = today) => {
    const sa = byDateSlot.get(`${d1} ${x}`), sb = byDateSlot.get(`${d2} ${y}`);
    if (!sa || !sb) { setErr(`Both reports must be generated first (${d1} ${x} and ${d2} ${y}).`); return; }
    setA(sa.id); setB(sb.id);
  };
  const prevDay = (() => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
  const metrics = res?.metrics.filter((m) => keys.includes(m.key)) ?? [];
  const label = (s: SnapshotMeta) => `${fmtDate(s.date)} · ${s.slot_label} (v${s.version})`;

  return (
    <div className="card">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><ArrowLeftRight size={16} />Compare two sessions</h3>
        <p className="text-xs text-slate-500">Change = second report minus first. Sessions are cumulative through the day, so 2 PM → 5 PM shows what was added in between.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3 p-4">
        <div><label className="label">First</label>
          <select className="input" value={a} onChange={(e) => setA(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Choose…</option>{snaps.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}
          </select></div>
        <div><label className="label">Second</label>
          <select className="input" value={b} onChange={(e) => setB(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Choose…</option>{snaps.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}
          </select></div>
        <div className="flex flex-wrap gap-1.5">
          <button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => quick("14:00", "17:00")}>2 PM vs 5 PM</button>
          <button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => quick("17:00", "19:00")}>5 PM vs 7 PM</button>
          <button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => quick("19:00", "21:00")}>7 PM vs 9 PM</button>
          <button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => quick("21:00", "21:00", prevDay, today)}>Today vs yesterday (9 PM)</button>
        </div>
      </div>
      {err && <p className="px-4 pb-3 text-sm text-red-700">{err}</p>}
      {res && (
        <div className="border-t border-slate-200">
          <div className="flex flex-wrap gap-3 px-4 py-3 text-xs">
            {res.metrics.map((m) => (
              <label key={m.key} className="flex items-center gap-1.5"><input type="checkbox" checked={keys.includes(m.key)}
                onChange={(e) => setKeys((k) => (e.target.checked ? [...k, m.key] : k.filter((x) => x !== m.key)))} />{m.label}</label>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr><th className="th" rowSpan={2}>Agent</th><th className="th" rowSpan={2}>Role</th>
                  {metrics.map((m) => <th key={m.key} className="th border-l border-slate-200 text-center" colSpan={3}>{m.label}</th>)}</tr>
                <tr>{metrics.map((m) => ["First", "Second", "Change"].map((h) => <th key={m.key + h} className={classNames("th text-center text-[10px]", h === "First" && "border-l border-slate-200")}>{h === "First" ? res.a.slot_label : h === "Second" ? res.b.slot_label : "Δ"}</th>))}</tr>
              </thead>
              <tbody>
                {res.rows.map((r) => (
                  <tr key={r.agent_id}>
                    <td className="td font-medium">{r.name}{!r.in_a && <span className="ml-1 text-xs text-slate-400">(new)</span>}{!r.in_b && <span className="ml-1 text-xs text-slate-400">(not in second)</span>}</td>
                    <td className="td text-xs capitalize text-slate-500">{r.role}</td>
                    {metrics.map((m) => <Trio key={m.key} a={r.a[m.key]} b={r.b[m.key]} d={r.delta[m.key]} m={m} />)}
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="td">Total</td><td className="td" />
                  {metrics.map((m) => <Trio key={m.key} a={res.totals[m.key].a} b={res.totals[m.key].b} d={res.totals[m.key].delta} m={m} />)}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Trio({ a, b, d, m }: { a: number | null; b: number | null; d: number | null; m: Comparison["metrics"][number] }) {
  return (
    <>
      <td className="td border-l border-slate-100 text-center tabular-nums text-slate-600">{fmtNumber(a, m)}</td>
      <td className="td text-center tabular-nums">{fmtNumber(b, m)}</td>
      <td className="td text-center font-semibold tabular-nums">{d === null ? <span className="font-normal italic text-slate-400">N/A</span> : `${d > 0 ? "+" : d < 0 ? "−" : "±"}${fmtNumber(Math.abs(d), m)}`}</td>
    </>
  );
}
