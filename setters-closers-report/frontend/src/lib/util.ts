import type { CellStatus, Formatting, Metric, Report, Row } from "./types";

export const TZ = "Asia/Kolkata";

export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** The session the user most likely wants now: the latest slot starting within the next 45 minutes. */
export function defaultSlot(slots: { value: string }[]): string {
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const [h, m] = now.split(":").map(Number);
  const mins = h * 60 + m + 45;
  let pick = slots[0]?.value ?? "14:00";
  for (const s of slots) {
    const [sh, sm] = s.value.split(":").map(Number);
    if (sh * 60 + sm <= mins) pick = s.value;
  }
  return pick;
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function fmtDate(d?: string): string {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", weekday: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, day)));
}

export function fmtNumber(v: number | null | undefined, m?: Metric, decimals = 1): string {
  if (v === null || v === undefined) return "N/A";
  if (m?.kind === "percent") return `${v.toFixed(1)}%`;
  if (m?.kind === "duration") return v.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (Math.abs(v - Math.round(v)) < 1e-9) return Math.round(v).toLocaleString("en-IN");
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function sortRows(rows: Row[], primary: string, secondary?: string): Row[] {
  const out = [...rows].sort((a, b) => {
    for (const k of [primary, secondary].filter(Boolean) as string[]) {
      const x = a.values[k], y = b.values[k];
      if (x === y) continue;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return y - x;
    }
    return a.name.localeCompare(b.name);
  });
  return out.map((r, i) => ({ ...r, rank: i + 1 }));
}

export function cellStyle(status: CellStatus, f: Formatting): React.CSSProperties {
  if (status === "met") return { backgroundColor: f.met_bg, color: f.met_text };
  if (status === "below") return { backgroundColor: f.below_bg, color: f.below_text };
  return {};
}

export function unitSuffix(m: Metric): string {
  return m.kind === "duration" ? "min" : m.kind === "percent" ? "%" : "";
}

export function slackSummary(r: Report): string {
  const s = r.session;
  const lines: string[] = [];
  lines.push(`*${r.title}*`);
  if (s) lines.push(`${fmtDate(s.date)} · ${s.slot_label} report${r.version ? ` (v${r.version})` : " (draft)"}`);
  const key = (k: string) => r.metrics.find((m) => m.key === k);
  for (const [sec, label] of [["setters", "Setters"], ["closers", "Closers"]] as const) {
    const t = r[sec].totals;
    const parts = [`${r[sec].count} agents`];
    if (key("bookings")) parts.push(`${t.bookings.total_display} bookings`);
    if (key("total_calls")) parts.push(`${t.total_calls.total_display} calls`);
    if (key("talk_time")) parts.push(`avg TT ${t.talk_time.average_display} min`);
    if (key("host_time")) parts.push(`avg host ${t.host_time.average_display} min`);
    const met = r[sec].rows.filter((x) => x.meets_all_targets).length;
    parts.push(`${met}/${r[sec].count} on all targets`);
    lines.push("");
    lines.push(`*${label}:* ${parts.join(" · ")}`);
    r[sec].rows.slice(0, 3).forEach((x) => {
      const bits = r.metrics.filter((m) => ["bookings", "talk_time", "host_time"].includes(m.key))
        .map((m) => `${m.label.replace(/\s*\(.*\)/, "")} ${x.display[m.key]}`);
      lines.push(`${x.rank}. ${x.name} - ${bits.join(", ")}`);
    });
  }
  if (r.cc_metrics.length) {
    lines.push("");
    lines.push("*CC:* " + r.cc_metrics.map((c) => `${c.label} ${c.total}`).join(" · "));
  }
  return lines.join("\n");
}

export function classNames(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}
