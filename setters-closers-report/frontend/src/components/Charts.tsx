import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Metric, Report, Row } from "../lib/types";
import { fmtNumber } from "../lib/util";

// Validated categorical slots 1 and 2 (see dataviz palette): identity, not status.
export const SETTER_COLOR = "#2a78d6";
export const CLOSER_COLOR = "#eb6834";
const INK = { primary: "#0b0b0b", secondary: "#52514e", muted: "#8a8984", grid: "#ecebe8" };

function TooltipBox({ active, payload, metric }: { active?: boolean; payload?: { payload: { name: string; role: string; value: number | null } }[]; metric: Metric }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="font-semibold text-slate-900">{p.name}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-slate-600">
        <span className="h-2 w-2 rounded-sm" style={{ background: p.role === "closer" ? CLOSER_COLOR : SETTER_COLOR }} />
        {p.role === "closer" ? "Closer" : "Setter"} · {metric.label}:{" "}
        <span className="font-semibold text-slate-900">{fmtNumber(p.value, metric)}{metric.kind === "duration" ? " min" : ""}</span>
      </div>
      {metric.threshold.enabled && p.value !== null && (
        <div className="mt-0.5 text-slate-500">{p.value >= metric.threshold.value ? "At or above" : "Below"} target of {metric.threshold.value}</div>
      )}
    </div>
  );
}

export function MetricBarChart({ rows, metric, height = 260, horizontal }: { rows: Row[]; metric: Metric; height?: number; horizontal?: boolean }) {
  const data = rows
    .filter((r) => r.values[metric.key] !== null && r.values[metric.key] !== undefined)
    .map((r) => ({ name: r.name, role: r.role, value: r.values[metric.key] as number }))
    .sort((a, b) => b.value - a.value);
  const missing = rows.length - data.length;
  if (!data.length) return <Empty text={`No ${metric.label} values in this session.`} height={height} />;
  const roles = new Set(data.map((d) => d.role));
  const th = metric.threshold.enabled ? metric.threshold.value : null;
  const h = horizontal ? Math.max(height, data.length * 26 + 40) : height;
  return (
    <div>
      {roles.size > 1 && (
        <div className="mb-1 flex justify-end gap-3 text-[11px] text-slate-600">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SETTER_COLOR }} />Setters</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: CLOSER_COLOR }} />Closers</span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 12, right: horizontal ? 24 : 56, bottom: 4, left: horizontal ? 8 : -12 }} barCategoryGap="22%">
          <CartesianGrid stroke={INK.grid} vertical={!!horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tick={{ fontSize: 11, fill: INK.muted }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: INK.secondary }} axisLine={false} tickLine={false} />
            </>
          ) : (
            <>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: INK.secondary }} interval={0} angle={data.length > 8 ? -35 : 0}
                textAnchor={data.length > 8 ? "end" : "middle"} height={data.length > 8 ? 70 : 30} axisLine={{ stroke: INK.grid }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: INK.muted }} axisLine={false} tickLine={false} />
            </>
          )}
          <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} content={<TooltipBox metric={metric} />} />
          {th !== null && (
            horizontal
              ? <ReferenceLine x={th} stroke={INK.secondary} strokeDasharray="4 4" label={{ value: `Target ${th}`, position: "top", fontSize: 10, fill: INK.secondary }} />
              : <ReferenceLine y={th} stroke={INK.secondary} strokeDasharray="4 4" label={{ value: `Target ${th}`, position: "right", fontSize: 10, fill: INK.secondary }} />
          )}
          <Bar dataKey="value" radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={30} stroke="#fff" strokeWidth={1}>
            {data.map((d) => <Cell key={d.name} fill={d.role === "closer" ? CLOSER_COLOR : SETTER_COLOR} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {missing > 0 && <p className="mt-1 text-xs text-slate-500">{missing} agent{missing > 1 ? "s" : ""} with N/A not shown.</p>}
    </div>
  );
}

function Empty({ text, height }: { text: string; height: number }) {
  return <div className="flex items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-500" style={{ height }}>{text}</div>;
}

export function ChartCard({ title, subtitle, children, action }: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function metricByKey(r: Report, key: string): Metric | undefined {
  return r.metrics.find((m) => m.key === key);
}
