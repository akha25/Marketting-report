import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import type { Report } from "../lib/types";
import { fmtDate, fmtDateTime, sortRows } from "../lib/util";
import ReportTable, { Legend } from "../components/ReportTable";
import { ChartCard, CLOSER_COLOR, MetricBarChart, SETTER_COLOR } from "../components/Charts";
import SummaryCards from "../components/SummaryCards";

export function useReport(): { report: Report | null; draft: boolean; empty: boolean } {
  const { view } = useSession();
  const report = view?.report ?? null;
  const empty = !report || report.setters.count + report.closers.count === 0;
  return { report, draft: view?.source === "draft", empty };
}

export function SourceNote() {
  const { view, session } = useSession();
  if (!view || !session) return null;
  const r = view.report;
  return (
    <p className="text-sm text-slate-500">
      {fmtDate(session.date)} · <b>{session.slot_label}</b> ·{" "}
      {view.source === "snapshot"
        ? <>Generated report v{r.version}, {fmtDateTime(r.generated_at)}</>
        : <span className="text-amber-700">Draft from current uploads (not generated yet{view.counts?.errors ? `, ${view.counts.errors} item(s) to fix` : ""})</span>}
    </p>
  );
}

export function EmptyState() {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="text-base font-semibold text-slate-900">No data for this session yet</div>
      <p className="max-w-md text-sm text-slate-500">Upload the dialer CSV, booking screenshot and CC screenshot for this session, then process and verify them.</p>
      <Link to="/upload" className="btn-primary">Go to Upload Reports</Link>
    </div>
  );
}

export function SortPicker({ report, value, onChange }: { report: Report; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      Sort by
      <select className="input py-1.5" value={value} onChange={(e) => onChange(e.target.value)}>
        {report.metrics.map((m) => <option key={m.key} value={m.key}>{m.label} (highest first)</option>)}
      </select>
    </label>
  );
}

export function RolePerformance({ role }: { role: "setters" | "closers" }) {
  const { report, empty } = useReport();
  const [sort, setSort] = useState<string>("");
  const [chartKey, setChartKey] = useState<string>("");
  if (!report || empty) return <Page title={role === "setters" ? "Setters Performance" : "Closers Performance"}><EmptyState /></Page>;
  const key = sort || report.sorting.primary;
  const ck = chartKey || report.sorting.primary;
  const metric = report.metrics.find((m) => m.key === ck) ?? report.metrics[0];
  const sec = report[role];
  const label = role === "setters" ? "Setters" : "Closers";
  return (
    <Page title={`${label} Performance`} actions={<><SortPicker report={report} value={key} onChange={setSort} /><Legend formatting={report.formatting} /></>}>
      <SummaryCards cards={[
        { label: `Total ${label}`, value: String(sec.count) },
        ...report.metrics.slice(0, 3).map((m) => ({ label: `${m.kind === "duration" ? "Avg" : "Total"} ${m.label}`, value: m.kind === "duration" ? sec.totals[m.key].average_display : sec.totals[m.key].total_display, unit: m.kind === "duration" ? "min" : null })),
      ]} />
      <ReportTable title={`${label} Performance`} section={sec} metrics={report.metrics} formatting={report.formatting}
        sortKey={key} secondaryKey={key === report.sorting.primary ? report.sorting.secondary : report.sorting.primary}
        accent={role === "setters" ? SETTER_COLOR : CLOSER_COLOR} />
      <ChartCard title={`${label}: ${metric.label} comparison`} action={
        <select className="input py-1 text-xs" value={metric.key} onChange={(e) => setChartKey(e.target.value)}>
          {report.metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>}>
        <MetricBarChart rows={sortRows(sec.rows, metric.key)} metric={metric} height={300} />
      </ChartCard>
    </Page>
  );
}

export function BookingReport() {
  const { report, empty } = useReport();
  const { preview } = useSession();
  if (!report || empty) return <Page title="Booking Report"><EmptyState /></Page>;
  const bm = report.metrics.find((m) => m.key === "bookings");
  const all = [...report.setters.rows, ...report.closers.rows];
  const b = report.booking;
  const shot = preview?.uploads.booking;
  return (
    <Page title="Booking Report">
      {b && <SummaryCards cards={[
        { label: `Total ${b.label}`, value: b.total }, { label: "Setter bookings", value: b.setters },
        { label: "Closer bookings", value: b.closers },
        { label: b.target !== null ? `Agents at ≥ ${b.target}` : "Agents with bookings", value: String(b.at_target) },
      ]} />}
      <div className="grid gap-4 xl:grid-cols-2">
        {bm ? (
          <ChartCard title="Booking distribution" subtitle="Bookings per agent, setters and closers">
            <MetricBarChart rows={all} metric={bm} horizontal height={280} />
          </ChartCard>
        ) : <div className="card p-4 text-sm text-slate-500">No Bookings metric is configured (Settings → Metrics).</div>}
        <div className="card overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3"><h3 className="text-sm font-semibold">Bookings by agent</h3></div>
          <table className="w-full text-left">
            <thead><tr><th className="th">#</th><th className="th">Agent</th><th className="th">Role</th><th className="th text-center">{bm?.label ?? "Bookings"}</th>
              {report.cc_metrics.map((c) => <th key={c.key} className="th text-center">CC: {c.label}</th>)}</tr></thead>
            <tbody>
              {sortRows(all, "bookings", report.sorting.secondary).map((r) => (
                <tr key={r.agent_id}>
                  <td className="td text-slate-500">{r.rank}</td><td className="td font-medium">{r.name}</td>
                  <td className="td text-xs capitalize text-slate-500">{r.role}</td>
                  <td className="td text-center font-semibold tabular-nums" style={r.status.bookings === "met" ? { background: report.formatting.met_bg, color: report.formatting.met_text } : r.status.bookings === "below" ? { background: report.formatting.below_bg, color: report.formatting.below_text } : {}}>
                    <span className={r.values.bookings === null ? "font-normal italic text-slate-400" : ""}>{r.display.bookings ?? "N/A"}</span>
                  </td>
                  {report.cc_metrics.map((c) => <td key={c.key} className={`td text-center tabular-nums ${r.values[c.key] === null ? "italic text-slate-400" : ""}`}>{r.display[c.key]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {shot?.processed && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold">Booking screenshot as uploaded</h3>
          <p className="mb-3 text-xs text-slate-500">{shot.filename} · read with {shot.provider}</p>
          <img src={api.fileUrl(shot.id)} alt="Booking screenshot" className="max-h-[480px] rounded-lg border border-slate-200" />
        </div>
      )}
    </Page>
  );
}

export function Page({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 className="text-xl font-semibold text-slate-900">{title}</h2><SourceNote /></div>
        {actions && <div className="flex flex-wrap items-center gap-4">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
