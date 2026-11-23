import { useMemo } from "react";
import type { Formatting, Metric, Section } from "../lib/types";
import { cellStyle, classNames, sortRows, unitSuffix } from "../lib/util";

interface Props {
  title: string;
  section: Section;
  metrics: Metric[];
  formatting: Formatting;
  sortKey?: string;
  secondaryKey?: string;
  /** Fixed layout for the screenshot canvas (no scrolling, slightly denser). */
  forCapture?: boolean;
  accent?: string;
}

export default function ReportTable({ title, section, metrics, formatting, sortKey, secondaryKey, forCapture, accent }: Props) {
  const rows = useMemo(
    () => (sortKey ? sortRows(section.rows, sortKey, secondaryKey) : section.rows),
    [section.rows, sortKey, secondaryKey],
  );
  const pad = forCapture ? "px-3 py-1.5" : "px-3 py-2";
  return (
    <div className={classNames(!forCapture && "card overflow-hidden")}>
      <div className={classNames("flex items-center gap-2", forCapture ? "mb-2" : "border-b border-slate-200 px-4 py-3")}>
        {accent && <span className="h-3 w-3 rounded-sm" style={{ background: accent }} />}
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <span className="text-xs text-slate-500">{section.count} agents</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">No agents in this category for this session.</div>
      ) : (
        <div className={classNames(!forCapture && "overflow-x-auto")}>
          <table className={classNames("w-full border-collapse text-left", forCapture && "rounded-lg border border-slate-200")}>
            <thead>
              <tr>
                <th className="th w-12 text-center">#</th>
                <th className="th">Agent</th>
                {metrics.map((m) => (
                  <th key={m.key} className="th text-center">
                    {m.label}
                    {unitSuffix(m) && m.kind === "duration" && <span className="ml-1 font-normal normal-case text-slate-400">(min)</span>}
                    {m.threshold.enabled && <div className="text-[10px] font-normal normal-case text-slate-400">target ≥ {m.threshold.value}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.agent_id} className="hover:bg-slate-50/60">
                  <td className={classNames("border-b border-slate-100 text-center text-sm font-semibold text-slate-500", pad)}>{r.rank}</td>
                  <td className={classNames("border-b border-slate-100 text-sm font-medium text-slate-900", pad)}>{r.name}</td>
                  {metrics.map((m) => {
                    const st = r.status[m.key];
                    const na = r.values[m.key] === null || r.values[m.key] === undefined;
                    return (
                      <td key={m.key} title={r.notes[m.key] || (na ? "Not available in the uploaded files" : undefined)}
                        className={classNames("whitespace-nowrap border-b border-l border-slate-100 text-center text-sm tabular-nums", pad,
                          na && "italic text-slate-400", st && st !== "na" && "font-semibold")}
                        style={cellStyle(st, formatting)}>
                        {r.display[m.key]}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td className={pad} />
                <td className={classNames("text-sm text-slate-700", pad)}>Total</td>
                {metrics.map((m) => (
                  <td key={m.key} className={classNames("border-l border-slate-100 text-center text-sm tabular-nums text-slate-900", pad)}>
                    {m.show_total === false ? "" : section.totals[m.key]?.total_display}
                  </td>
                ))}
              </tr>
              <tr className="bg-slate-50 text-slate-600">
                <td className={pad} />
                <td className={classNames("text-sm", pad)}>Average</td>
                {metrics.map((m) => (
                  <td key={m.key} className={classNames("border-l border-slate-100 text-center text-sm tabular-nums", pad)}>
                    {m.show_average === false ? "" : section.totals[m.key]?.average_display}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export function Legend({ formatting, compact }: { formatting: Formatting; compact?: boolean }) {
  return (
    <div className={classNames("flex flex-wrap items-center gap-4 text-xs text-slate-600", compact && "gap-3")}>
      <span className="flex items-center gap-1.5">
        <span className="h-3.5 w-5 rounded border border-black/5" style={{ background: formatting.below_bg }} /> Light Red = Below Target
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3.5 w-5 rounded border border-black/5" style={{ background: formatting.met_bg }} /> Light Green = Target Achieved
      </span>
      <span className="flex items-center gap-1.5"><span className="italic text-slate-400">N/A</span> = not in the uploaded files (0 means zero)</span>
    </div>
  );
}
