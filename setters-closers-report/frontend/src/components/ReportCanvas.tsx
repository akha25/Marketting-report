import { forwardRef } from "react";
import type { Report } from "../lib/types";
import { fmtDate, fmtDateTime } from "../lib/util";
import { CLOSER_COLOR, SETTER_COLOR } from "./Charts";
import ReportTable, { Legend } from "./ReportTable";
import SummaryCards from "./SummaryCards";

/** The exact area captured for Slack: no navigation, buttons or upload controls. */
const ReportCanvas = forwardRef<HTMLDivElement, { report: Report; draft?: boolean }>(({ report, draft }, ref) => {
  const s = report.session;
  const b = report.booking;
  return (
    <div ref={ref} className="bg-white p-8 text-slate-900" style={{ width: 1280, fontFamily: "Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
      <div className="flex items-end justify-between border-b border-slate-200 pb-4">
        <div>
          <div className="text-[22px] font-bold tracking-tight">{report.title}</div>
          <div className="mt-1 text-sm text-slate-600">
            {s ? `${fmtDate(s.date)} · ${s.slot_label} report` : ""}
            {report.version ? ` · v${report.version}` : ""}
            {report.generated_at ? ` · generated ${fmtDateTime(report.generated_at)} IST` : ""}
          </div>
        </div>
        {draft && <span className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">DRAFT - not yet generated</span>}
      </div>

      <div className="mt-5"><SummaryCards cards={report.summary.cards} compact /></div>

      <div className="mt-6"><ReportTable title="Setters Performance" section={report.setters} metrics={report.metrics} formatting={report.formatting} forCapture accent={SETTER_COLOR} /></div>
      <div className="mt-6"><ReportTable title="Closers Performance" section={report.closers} metrics={report.metrics} formatting={report.formatting} forCapture accent={CLOSER_COLOR} /></div>

      <div className="mt-6 grid grid-cols-2 gap-4">
        {b && (
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="text-sm font-semibold">Booking summary</div>
            <div className="mt-2 flex gap-6 text-sm">
              <div><div className="text-xs text-slate-500">Total {b.label}</div><div className="text-xl font-semibold tabular-nums">{b.total}</div></div>
              <div><div className="text-xs text-slate-500">Setters</div><div className="text-xl font-semibold tabular-nums">{b.setters}</div></div>
              <div><div className="text-xs text-slate-500">Closers</div><div className="text-xl font-semibold tabular-nums">{b.closers}</div></div>
              {b.target !== null && <div><div className="text-xs text-slate-500">At ≥ {b.target}</div><div className="text-xl font-semibold tabular-nums">{b.at_target}</div></div>}
            </div>
            {b.top.length > 0 && (
              <div className="mt-3 text-xs text-slate-600">
                Top: {b.top.slice(0, 3).map((t, i) => `${i + 1}. ${t.name} (${t.value})`).join("   ")}
              </div>
            )}
          </div>
        )}
        <div className="rounded-lg border border-slate-200 p-4">
          <div className="text-sm font-semibold">Overall performance</div>
          <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
            {report.metrics.filter((m) => m.show_total !== false || m.show_average !== false).slice(0, 6).map((m) => {
              const o = report.overall[m.key];
              const useAvg = m.kind === "duration";
              return (
                <div key={m.key}>
                  <div className="text-xs text-slate-500">{(() => { const p = useAvg ? "Avg" : m.kind === "percent" ? "Overall" : "Total"; return m.label.toLowerCase().startsWith(p.toLowerCase()) ? m.label : `${p} ${m.label}`; })()}</div>
                  <div className="font-semibold tabular-nums">{useAvg ? o?.average_display : o?.total_display}{m.kind === "duration" && o?.average !== null ? " min" : ""}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3">
        <Legend formatting={report.formatting} compact />
        <div className="text-[11px] text-slate-400">
          {(report.files ?? []).map((f) => f.label).join(" + ")}
        </div>
      </div>
    </div>
  );
});
ReportCanvas.displayName = "ReportCanvas";
export default ReportCanvas;
