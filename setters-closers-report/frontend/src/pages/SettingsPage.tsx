import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import type { AgentInfo, Metric, Settings } from "../lib/types";
import { classNames } from "../lib/util";
import { Page } from "./ReportPages";

const SOURCES = [
  { v: "csv", l: "Dialer CSV" }, { v: "booking", l: "Booking screenshot" }, { v: "cc", l: "CC screenshot" }, { v: "derived", l: "Calculated" },
];
const KINDS = [{ v: "count", l: "Count" }, { v: "duration", l: "Time (minutes)" }, { v: "number", l: "Number" }, { v: "percent", l: "Percent" }];

export default function SettingsPage() {
  const { settings, setSettings, health, reload } = useSession();
  const [s, setS] = useState<Settings | null>(settings);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tab, setTab] = useState("metrics");
  useEffect(() => setS(settings), [settings]);
  useEffect(() => { api.agents().then(setAgents); }, []);
  if (!s) return null;

  const save = async () => {
    try {
      const saved = await api.saveSettings(s);
      setSettings(saved);
      setS(saved);
      await reload();
      setMsg({ ok: true, text: "Settings saved. Reports recalculate with them; generated versions keep the settings they were made with." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  const upd = (i: number, patch: Partial<Metric>) => setS({ ...s, metrics: s.metrics.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const move = (i: number, d: number) => {
    const ms = [...s.metrics];
    const j = i + d;
    if (j < 0 || j >= ms.length) return;
    [ms[i], ms[j]] = [ms[j], ms[i]];
    setS({ ...s, metrics: ms });
  };
  const remove = (i: number) => {
    const m = s.metrics[i];
    const used = s.metrics.filter((x) => x.formula && (x.formula.numerator === m.key || x.formula.denominator === m.key));
    if (used.length) { setMsg({ ok: false, text: `${m.label} is used by ${used.map((x) => x.label).join(", ")}. Change that formula first.` }); return; }
    if (confirm(`Remove the metric "${m.label}"? Past generated reports keep it.`)) setS({ ...s, metrics: s.metrics.filter((_, j) => j !== i) });
  };
  const add = () => setS({ ...s, metrics: [...s.metrics, { key: "", label: "New metric", source: "csv", kind: "count", visible: true, threshold: { enabled: false, value: 0 }, show_total: true, show_average: true, call_log: "sum" }] });
  const numeric = s.metrics.filter((m) => m.key);
  const list = (v: string[]) => v.join(", ");
  const parse = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

  const TABS = [["metrics", "Metrics & targets"], ["agents", "Agents"], ["matching", "Columns & matching"], ["display", "Display"], ["system", "System"]];
  return (
    <Page title="Settings" actions={<button className="btn-primary" onClick={save}><Save size={16} />Save settings</button>}>
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={classNames("-mb-px border-b-2 px-4 py-2 text-sm font-medium", tab === k ? "border-brand-500 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>{l}</button>
        ))}
      </div>
      {msg && <div className={classNames("rounded-lg px-4 py-2.5 text-sm", msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800")}>{msg.text}</div>}

      {tab === "metrics" && (
        <div className="space-y-4">
          <div className="card overflow-x-auto">
            <table className="w-full text-left">
              <thead><tr>{["Order", "Name", "Comes from", "Type", "Show", "Target (light green at or above)", "Totals / averages", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>
                {s.metrics.map((m, i) => (
                  <tr key={i} className="align-top">
                    <td className="td"><div className="flex gap-0.5">
                      <button className="btn-ghost p-1" onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={14} /></button>
                      <button className="btn-ghost p-1" onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={14} /></button></div></td>
                    <td className="td"><input className="input w-44 py-1.5" value={m.label} onChange={(e) => upd(i, { label: e.target.value })} />
                      <div className="mt-0.5 text-[10px] text-slate-400">{m.key || "key set on save"}</div></td>
                    <td className="td">
                      <select className="input py-1.5" value={m.source} onChange={(e) => upd(i, { source: e.target.value as Metric["source"], formula: e.target.value === "derived" ? (m.formula ?? { numerator: numeric[0]?.key, denominator: numeric[1]?.key, multiplier: 100 }) : undefined })}>
                        {SOURCES.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
                      </select>
                      {m.source === "derived" && m.formula && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
                          <select className="input py-1 text-xs" value={m.formula.numerator} onChange={(e) => upd(i, { formula: { ...m.formula!, numerator: e.target.value } })}>
                            {numeric.filter((x) => x.key !== m.key).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
                          ÷
                          <select className="input py-1 text-xs" value={m.formula.denominator} onChange={(e) => upd(i, { formula: { ...m.formula!, denominator: e.target.value } })}>
                            {numeric.filter((x) => x.key !== m.key).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
                          ×<input type="number" className="input w-16 py-1 text-xs" value={m.formula.multiplier} onChange={(e) => upd(i, { formula: { ...m.formula!, multiplier: Number(e.target.value) } })} />
                        </div>
                      )}
                    </td>
                    <td className="td"><select className="input py-1.5" value={m.kind} onChange={(e) => upd(i, { kind: e.target.value as Metric["kind"] })}>
                      {KINDS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select>
                      {m.source === "csv" && m.source !== ("derived" as string) && (
                        <label className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-500"><input type="checkbox" checked={m.call_log === "count"} onChange={(e) => upd(i, { call_log: e.target.checked ? "count" : "sum" })} />Count rows in a call-log CSV</label>
                      )}</td>
                    <td className="td"><input type="checkbox" checked={m.visible !== false} onChange={(e) => upd(i, { visible: e.target.checked })} aria-label="Show in tables" /></td>
                    <td className="td"><div className="flex items-center gap-2">
                      <input type="checkbox" checked={m.threshold.enabled} onChange={(e) => upd(i, { threshold: { ...m.threshold, enabled: e.target.checked } })} aria-label="Colour this metric" />
                      <input type="number" className="input w-24 py-1.5" disabled={!m.threshold.enabled} value={m.threshold.value} onChange={(e) => upd(i, { threshold: { ...m.threshold, value: Number(e.target.value) } })} />
                      {m.kind === "duration" && <span className="text-xs text-slate-500">min</span>}</div></td>
                    <td className="td text-xs">
                      <label className="flex items-center gap-1"><input type="checkbox" checked={m.show_total !== false} onChange={(e) => upd(i, { show_total: e.target.checked })} />Total</label>
                      <label className="flex items-center gap-1"><input type="checkbox" checked={m.show_average !== false} onChange={(e) => upd(i, { show_average: e.target.checked })} />Average</label></td>
                    <td className="td"><button className="btn-ghost p-1.5 text-red-600" onClick={() => remove(i)} aria-label="Remove"><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-3"><button className="btn-secondary" onClick={add}><Plus size={15} />Add metric</button></div>
          </div>
          <div className="card grid gap-4 p-4 md:grid-cols-3">
            <div><label className="label">Sort by (highest first)</label>
              <select className="input w-full" value={s.sorting.primary} onChange={(e) => setS({ ...s, sorting: { ...s.sorting, primary: e.target.value } })}>
                {numeric.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></div>
            <div><label className="label">Then by</label>
              <select className="input w-full" value={s.sorting.secondary} onChange={(e) => setS({ ...s, sorting: { ...s.sorting, secondary: e.target.value } })}>
                {numeric.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></div>
            <div><label className="label">Agents missing from a screenshot</label>
              {(["booking", "cc"] as const).map((k) => (
                <div key={k} className="mb-1 flex items-center gap-2 text-sm">
                  <span className="w-20 text-slate-600">{k === "booking" ? "Booking" : "CC"}</span>
                  <select className="input py-1 text-xs" value={s.absent_in_screenshot[k]} onChange={(e) => setS({ ...s, absent_in_screenshot: { ...s.absent_in_screenshot, [k]: e.target.value as "na" | "zero" } })}>
                    <option value="na">Show N/A (unknown)</option><option value="zero">Count as 0</option></select>
                </div>))}
            </div>
          </div>
        </div>
      )}

      {tab === "agents" && (
        <div className="card overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr>{["Name", "Email", "Role", "Role set by", "Other spellings matched"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {agents.length === 0 && <tr><td colSpan={5} className="td py-6 text-center text-slate-500">Agents appear here once a dialer CSV is uploaded.</td></tr>}
              {agents.map((a) => (
                <tr key={a.id}>
                  <td className="td"><input className="input w-56 py-1.5" defaultValue={a.name} onBlur={(e) => e.target.value !== a.name && api.updateAgent(a.id, { name: e.target.value }).then(() => api.agents().then(setAgents))} /></td>
                  <td className="td"><input className="input w-64 py-1.5" defaultValue={a.email ?? ""} onBlur={(e) => e.target.value !== (a.email ?? "") && api.updateAgent(a.id, { email: e.target.value }).then(() => api.agents().then(setAgents))} /></td>
                  <td className="td"><select className="input py-1.5" value={a.role ?? ""} onChange={(e) => api.updateAgent(a.id, { role: e.target.value || null }).then(() => { api.agents().then(setAgents); reload(); })}>
                    <option value="">Not set</option><option value="setter">Setter</option><option value="closer">Closer</option><option value="excluded">Excluded</option></select></td>
                  <td className="td text-xs text-slate-500">{a.role_source ?? "-"}</td>
                  <td className="td text-xs text-slate-500">{a.aliases.join(", ") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "matching" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card space-y-3 p-4">
            <h3 className="text-sm font-semibold">Setter / closer keywords (CSV team column)</h3>
            <div><label className="label">Setter keywords</label><input className="input w-full" value={list(s.classification.setter_keywords)} onChange={(e) => setS({ ...s, classification: { ...s.classification, setter_keywords: parse(e.target.value) } })} /></div>
            <div><label className="label">Closer keywords</label><input className="input w-full" value={list(s.classification.closer_keywords)} onChange={(e) => setS({ ...s, classification: { ...s.classification, closer_keywords: parse(e.target.value) } })} /></div>
            <h3 className="pt-2 text-sm font-semibold">Accuracy</h3>
            <div><label className="label">Screenshot readings below this confidence must be checked</label>
              <input type="number" step="0.05" min="0" max="1" className="input w-28" value={s.ocr.confidence_threshold} onChange={(e) => setS({ ...s, ocr: { confidence_threshold: Number(e.target.value) } })} /></div>
            <div><label className="label">Suggest similar names from this score (never auto-applied)</label>
              <input type="number" step="0.05" min="0.3" max="1" className="input w-28" value={s.matching.suggest_min} onChange={(e) => setS({ ...s, matching: { suggest_min: Number(e.target.value) } })} /></div>
          </div>
          <div className="card space-y-3 p-4">
            <h3 className="text-sm font-semibold">Header names recognised automatically</h3>
            <p className="text-xs text-slate-500">Comma-separated. Case, spaces and punctuation are ignored. Your manual mappings are also remembered per header.</p>
            {Object.entries(s.aliases).map(([k, v]) => (
              <div key={k}><label className="label">{({ __name__: "Agent name", __email__: "Agent email", __team__: "Team / role" } as Record<string, string>)[k] ?? s.metrics.find((m) => m.key === k)?.label ?? k}</label>
                <input className="input w-full text-xs" value={list(v)} onChange={(e) => setS({ ...s, aliases: { ...s.aliases, [k]: parse(e.target.value) } })} /></div>
            ))}
            {s.metrics.filter((m) => m.source !== "derived" && !(m.key in s.aliases) && m.key).map((m) => (
              <button key={m.key} className="btn-ghost text-xs" onClick={() => setS({ ...s, aliases: { ...s.aliases, [m.key]: [m.label.toLowerCase()] } })}><Plus size={12} />Header names for {m.label}</button>
            ))}
          </div>
        </div>
      )}

      {tab === "display" && (
        <div className="card grid gap-4 p-4 md:grid-cols-2">
          <div><label className="label">Report title</label><input className="input w-full" value={s.report_title} onChange={(e) => setS({ ...s, report_title: e.target.value })} /></div>
          <div><label className="label">Decimals for time values</label><input type="number" min="0" max="2" className="input w-24" value={s.duration_decimals} onChange={(e) => setS({ ...s, duration_decimals: Number(e.target.value) })} /></div>
          {([["below_bg", "Below target background"], ["below_text", "Below target text"], ["met_bg", "Target achieved background"], ["met_text", "Target achieved text"]] as const).map(([k, l]) => (
            <div key={k} className="flex items-center gap-3">
              <input type="color" value={s.formatting[k]} onChange={(e) => setS({ ...s, formatting: { ...s.formatting, [k]: e.target.value } })} className="h-9 w-14 rounded border border-slate-300" />
              <span className="text-sm text-slate-700">{l}</span>
            </div>
          ))}
          <div className="md:col-span-2"><span className="inline-block rounded px-3 py-1 text-sm font-semibold" style={{ background: s.formatting.below_bg, color: s.formatting.below_text }}>84.0</span>
            <span className="ml-2 inline-block rounded px-3 py-1 text-sm font-semibold" style={{ background: s.formatting.met_bg, color: s.formatting.met_text }}>102.5</span></div>
        </div>
      )}

      {tab === "system" && health && (
        <div className="card space-y-2 p-4 text-sm">
          <div>Screenshot reading: <b>{health.ocr_provider === "anthropic" ? "Claude image reading" : health.ocr_provider === "tesseract" ? "Free OCR (Tesseract)" : "Manual entry"}</b>
            {!health.anthropic_configured && <span className="text-slate-500"> · set ANTHROPIC_API_KEY on the server for higher accuracy</span>}</div>
          <div>Database: <b>{health.database}</b></div>
          <div>Time zone: <b>{health.timezone}</b> (today is {health.today})</div>
          <button className="btn-danger mt-3" onClick={async () => { if (confirm("Reset metrics, targets and display settings to defaults? Remembered column mappings are kept.")) { const r = await api.resetSettings(); setSettings(r); setS(r); await reload(); } }}>Reset settings to defaults</button>
        </div>
      )}
    </Page>
  );
}
