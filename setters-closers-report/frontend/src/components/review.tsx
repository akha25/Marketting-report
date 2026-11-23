import { useRef, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Eye, EyeOff, FileUp, Info, Plus, RefreshCw, UserPlus, X } from "lucide-react";
import type { Issue, Kind, MapEntry, Match, Preview, Row, UploadInfo } from "../lib/types";
import { classNames, fmtDateTime } from "../lib/util";
import { api } from "../lib/api";

/* ------------------------------------------------------------ upload card */

export function UploadCard({ kind, title, subtitle, accept, upload, onFile, busy }: {
  kind: Kind; title: string; subtitle: string; accept: string; upload?: UploadInfo; onFile: (f: File) => void; busy?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const status = !upload ? null : upload.error ? "error" : upload.processed ? "read" : "waiting";
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      className={classNames("card flex flex-col p-4 transition", over && "border-brand-500 ring-2 ring-brand-100")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="text-xs text-slate-500">{subtitle}</div>
        </div>
        {status === "read" && <span className="chip bg-emerald-50 text-emerald-700"><CheckCircle2 size={12} />{kind === "csv" ? "Read" : `Read (${upload!.provider})`}</span>}
        {status === "waiting" && <span className="chip bg-amber-50 text-amber-800">Not read yet</span>}
        {status === "error" && <span className="chip bg-red-50 text-red-700">Reading failed</span>}
      </div>
      <button type="button" disabled={busy} onClick={() => input.current?.click()}
        className="mt-3 flex flex-1 flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center hover:border-brand-500 hover:bg-brand-50/40">
        <FileUp className="text-slate-400" size={22} />
        <span className="mt-2 text-sm font-medium text-slate-700">{busy ? "Uploading…" : upload ? "Drop a new file to replace" : "Drag & drop, or browse"}</span>
        <span className="text-xs text-slate-500">{accept.replaceAll(",", ", ")}</span>
      </button>
      <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      {upload && (
        <div className="mt-3 space-y-0.5 text-xs text-slate-600">
          <div className="truncate font-medium text-slate-800" title={upload.filename}>{upload.filename}</div>
          <div>Uploaded {fmtDateTime(upload.uploaded_at)} · {upload.size < 1024 ? `${upload.size} B` : `${(upload.size / 1024).toFixed(0)} KB`} · #{upload.sha}</div>
          {upload.kind === "csv" && upload.row_count !== undefined && <div>{upload.row_count} rows · {upload.headers?.length} columns</div>}
          {upload.error && <div className="text-red-700">{upload.error}</div>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ issues */

const SEV = {
  error: { icon: AlertCircle, cls: "text-red-700", bg: "bg-red-50 border-red-200", label: "To fix" },
  warning: { icon: AlertTriangle, cls: "text-amber-700", bg: "bg-amber-50 border-amber-200", label: "Check" },
  info: { icon: Info, cls: "text-slate-500", bg: "bg-slate-50 border-slate-200", label: "Info" },
};

export function IssuesPanel({ issues, onAck, onPolicy, onIgnoreRow, onRole }: {
  issues: Issue[];
  onAck: (uploadId: number) => void;
  onPolicy: (uploadId: number, p: string) => void;
  onIgnoreRow: (uploadId: number, row: number) => void;
  onRole: (agentId: number, role: string) => void;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const shown = issues.filter((i) => showInfo || i.severity !== "info");
  const errors = issues.filter((i) => i.severity === "error").length;
  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          {errors ? <AlertCircle size={16} className="text-red-600" /> : <CheckCircle2 size={16} className="text-emerald-600" />}
          {errors ? `${errors} item${errors > 1 ? "s" : ""} to fix before generating` : "Ready: all checks passed"}
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={() => setShowInfo(!showInfo)}>{showInfo ? <EyeOff size={14} /> : <Eye size={14} />} {showInfo ? "Hide" : "Show"} info</button>
      </div>
      <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
        {shown.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">Nothing to report.</li>}
        {shown.map((i, n) => {
          const S = SEV[i.severity];
          return (
            <li key={n} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              <S.icon size={16} className={classNames("mt-0.5 shrink-0", S.cls)} />
              <div className="min-w-0 flex-1">
                <span className="mr-2 text-xs font-medium text-slate-500">{i.source}</span>
                <span className="text-slate-800">{i.message}</span>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {i.code === "duplicate_file" && i.upload_id && <button className="btn-secondary px-2 py-1 text-xs" onClick={() => onAck(i.upload_id!)}>It's intended, use it</button>}
                {i.code === "duplicate_agent" && i.upload_id && (
                  <select className="input py-1 text-xs" defaultValue="" onChange={(e) => e.target.value && onPolicy(i.upload_id!, e.target.value)}>
                    <option value="" disabled>Combine rows…</option>
                    <option value="sum">Add them up</option>
                    <option value="first">Keep first row</option>
                    <option value="last">Keep last row</option>
                  </select>
                )}
                {i.code === "no_name" && i.upload_id !== undefined && i.row !== undefined && (
                  <button className="btn-secondary px-2 py-1 text-xs" onClick={() => onIgnoreRow(i.upload_id!, i.row!)}>Ignore row</button>
                )}
                {i.code === "role_needed" && i.agent_id && (
                  <>
                    <button className="btn-secondary px-2 py-1 text-xs" onClick={() => onRole(i.agent_id!, "setter")}>Setter</button>
                    <button className="btn-secondary px-2 py-1 text-xs" onClick={() => onRole(i.agent_id!, "closer")}>Closer</button>
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => onRole(i.agent_id!, "excluded")}>Exclude</button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------ CSV mapping */

function FieldSelect({ up, value, onChange }: { up: UploadInfo; value: string; onChange: (v: string) => void }) {
  return (
    <select className="input w-full py-1.5" value={value} onChange={(e) => onChange(e.target.value)}>
      <optgroup label="Agent">
        {up.fields.filter((f) => f.system).map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </optgroup>
      <optgroup label="Metrics">
        {up.fields.filter((f) => !f.system).map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </optgroup>
    </select>
  );
}

function UnitPicker({ up, m, onChange }: { up: UploadInfo; m: MapEntry; onChange: (m: MapEntry) => void }) {
  return (
    <div className="flex items-center gap-2">
      <select className="input py-1.5 text-xs" value={m.unit ?? ""} onChange={(e) => onChange({ ...m, unit: e.target.value, unit_confirmed: true })}>
        <option value="" disabled>Unit…</option>
        {Object.entries(up.units).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      {m.unit_confirmed
        ? <span className="chip bg-emerald-50 text-emerald-700"><CheckCircle2 size={12} />Confirmed</span>
        : <button className="btn-secondary px-2 py-1 text-xs ring-2 ring-amber-200" onClick={() => onChange({ ...m, unit_confirmed: true })}>Confirm unit</button>}
    </div>
  );
}

function NewMetricButton({ onCreate, header }: { header: string; onCreate: (label: string, kind: string, unit?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(header);
  const [kind, setKind] = useState("count");
  const [unit, setUnit] = useState("minutes");
  if (!open) return <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(true)}><Plus size={13} />Add as metric</button>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input className="input w-32 py-1 text-xs" value={label} onChange={(e) => setLabel(e.target.value)} />
      <select className="input py-1 text-xs" value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="count">Count</option><option value="number">Number</option><option value="duration">Time</option><option value="percent">Percent</option>
      </select>
      {kind === "duration" && (
        <select className="input py-1 text-xs" value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option value="minutes">minutes</option><option value="seconds">seconds</option><option value="hours">hours</option>
          <option value="hh:mm:ss">h:mm:ss</option><option value="mm:ss">mm:ss</option><option value="hh:mm">hh:mm</option>
        </select>
      )}
      <button className="btn-primary px-2 py-1 text-xs" onClick={() => { onCreate(label, kind, kind === "duration" ? unit : undefined); setOpen(false); }}>Add</button>
      <button className="btn-ghost px-1.5 py-1" onClick={() => setOpen(false)}><X size={13} /></button>
    </div>
  );
}

export function CsvMapping({ up, onPatch }: { up: UploadInfo; onPatch: (body: Record<string, unknown>) => void }) {
  const headers = up.headers ?? [];
  const sample = (i: number) => (up.sample_rows ?? []).map((r) => r[i]).filter((v) => v !== null && v !== "").slice(0, 3);
  const setMap = (i: number, m: MapEntry) => {
    const mapping = up.mapping.map((x, j) => (j === i ? m : x));
    onPatch({ mapping });
  };
  const isDuration = (f: string) => up.fields.find((x) => x.value === f)?.kind === "duration";
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Dialer CSV columns</h3>
          <p className="text-xs text-slate-500">Read from the file's own headers. Your choices are remembered for the next upload.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">File type</span>
          <select className="input py-1 text-xs" value={up.options.mode ?? up.meta.mode ?? "summary"} onChange={(e) => onPatch({ options: { mode: e.target.value } })}>
            <option value="summary">One row per agent (summary)</option>
            <option value="call_log">One row per call (call log)</option>
          </select>
          <span className="text-slate-500">Duplicate rows</span>
          <select className="input py-1 text-xs" value={up.options.duplicate_policy ?? ""} onChange={(e) => onPatch({ options: { duplicate_policy: e.target.value || null } })}>
            <option value="">Ask me</option><option value="sum">Add up</option><option value="first">Keep first</option><option value="last">Keep last</option>
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead><tr><th className="th">Column in file</th><th className="th">Sample values</th><th className="th w-64">Maps to</th><th className="th">Unit / action</th></tr></thead>
          <tbody>
            {headers.map((h, i) => {
              const m = up.mapping[i];
              return (
                <tr key={i} className={m.field === "__ignore__" ? "text-slate-500" : ""}>
                  <td className="td font-medium">{h || <span className="italic text-slate-400">(no header)</span>}</td>
                  <td className="td max-w-xs truncate text-xs text-slate-500">{sample(i).join(" · ") || "-"}</td>
                  <td className="td"><FieldSelect up={up} value={m.field} onChange={(v) => setMap(i, { ...m, field: v, unit: isDuration(v) ? (m.unit ?? "minutes") : null, unit_confirmed: isDuration(v) ? m.unit_confirmed : false })} /></td>
                  <td className="td">
                    {isDuration(m.field) ? <UnitPicker up={up} m={m} onChange={(nm) => setMap(i, nm)} />
                      : m.field === "__ignore__" ? <NewMetricButton header={h} onCreate={(label, kind, unit) => onPatch({ new_metric: { column: i, label, kind, unit } })} /> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ screenshot grid */

export function ScreenshotReview({ up, issues, onPatch, onReread }: {
  up: UploadInfo; issues: Issue[]; onPatch: (body: Record<string, unknown>) => void; onReread: (provider: string) => void;
}) {
  const [zoom, setZoom] = useState(false);
  if (!up.processed) {
    return (
      <div className="card p-4 text-sm text-slate-600">
        <b>{up.label}:</b> {up.error ? <span className="text-red-700">{up.error}</span> : "Click Process Reports to read this screenshot."}
        {up.error && <div className="mt-2 flex gap-2">
          <button className="btn-secondary text-xs" onClick={() => onReread("tesseract")}>Read with free OCR</button>
          <button className="btn-secondary text-xs" onClick={() => onReread("manual")}>Type it in manually</button>
        </div>}
      </div>
    );
  }
  const headers = up.headers ?? [];
  const rows = up.rows ?? [];
  const th = up.confidence_threshold ?? 0.9;
  const ignored = new Set(up.options.ignored_rows ?? []);
  const bad = new Set(issues.filter((i) => i.upload_id === up.id && (i.code === "bad_value" || i.code === "uncertain_cell")).map((i) => `${i.row}:${i.column}`));
  const mapped = (c: number) => up.mapping[c] && up.mapping[c].field !== "__ignore__";
  const uncertainRows = rows.map((r, ri) => r.some((c, ci) => mapped(ci) && c.confidence !== null && c.confidence < th && !c.verified) && !ignored.has(ri));
  const setMap = (i: number, m: MapEntry) => onPatch({ mapping: up.mapping.map((x, j) => (j === i ? m : x)) });
  const isDuration = (f: string) => up.fields.find((x) => x.value === f)?.kind === "duration";
  const toggleIgnore = (ri: number) => {
    const s = new Set(ignored);
    if (s.has(ri)) s.delete(ri); else s.add(ri);
    onPatch({ options: { ignored_rows: [...s].sort((a, b) => a - b) } });
  };
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{up.label}: extracted table</h3>
          <p className="text-xs text-slate-500">
            Read with <b>{up.provider}</b>. <span className="rounded bg-amber-100 px-1">Amber</span> = uncertain reading, check against the image.
            Typing a value marks it checked. <span className="rounded bg-sky-50 px-1">Blue</span> = corrected by you.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(up.tables?.length ?? 0) > 1 && (
            <select className="input py-1 text-xs" value={up.table_index} onChange={(e) => onPatch({ table_index: Number(e.target.value) })}>
              {up.tables!.map((t, i) => <option key={i} value={i}>Table {i + 1}{t.title ? `: ${t.title}` : ""} ({t.rows} rows)</option>)}
            </select>
          )}
          <button className="btn-ghost py-1 text-xs" onClick={() => onReread("anthropic")}><RefreshCw size={13} />Re-read with Claude</button>
          <button className="btn-ghost py-1 text-xs" onClick={() => onReread("tesseract")}><RefreshCw size={13} />Re-read with free OCR</button>
        </div>
      </div>
      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div>
          <button onClick={() => setZoom(true)} className="block w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50" title="Click to enlarge">
            <img src={api.fileUrl(up.id)} alt={`${up.label} as uploaded`} className="max-h-[520px] w-full object-contain" />
          </button>
          {!!up.other_text?.length && <p className="mt-2 text-xs text-slate-500">Other text: {up.other_text.join(" · ")}</p>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                <th className="th w-10">#</th>
                {headers.map((h, c) => (
                  <th key={c} className="th min-w-[140px] align-top normal-case">
                    <div className="mb-1 truncate text-[11px] uppercase text-slate-500">{h || "(no header)"}</div>
                    <FieldSelect up={up} value={up.mapping[c]?.field ?? "__ignore__"}
                      onChange={(v) => setMap(c, { field: v, unit: isDuration(v) ? "minutes" : null, unit_confirmed: false })} />
                    {isDuration(up.mapping[c]?.field) && <div className="mt-1"><UnitPicker up={up} m={up.mapping[c]} onChange={(nm) => setMap(c, nm)} /></div>}
                    {up.mapping[c]?.field === "__ignore__" && <div className="mt-1"><NewMetricButton header={h} onCreate={(label, kind, unit) => onPatch({ new_metric: { column: c, label, kind, unit } })} /></div>}
                  </th>
                ))}
                <th className="th w-28" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className={ignored.has(ri) ? "opacity-40" : ""}>
                  <td className="td text-xs text-slate-400">{ri + 1}</td>
                  {r.map((cell, ci) => {
                    const unsure = mapped(ci) && cell.confidence !== null && cell.confidence < th && !cell.verified;
                    return (
                      <td key={`${ri}-${ci}-${cell.text}`} className="border-b border-slate-100 p-1">
                        <input defaultValue={cell.text ?? ""} title={[cell.note, cell.original !== cell.text && cell.original ? `read as "${cell.original}"` : "", cell.confidence !== null ? `confidence ${Math.round((cell.confidence ?? 0) * 100)}%` : ""].filter(Boolean).join(" · ")}
                          onBlur={(e) => { if ((e.target.value.trim() || null) !== (cell.text ?? null)) onPatch({ cells: [{ row: ri, col: ci, text: e.target.value }] }); }}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          className={classNames("w-full rounded-md border px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-100",
                            unsure ? "border-amber-300 bg-amber-100" : cell.edited ? "border-sky-200 bg-sky-50" : "border-transparent bg-transparent hover:border-slate-200",
                            bad.has(`${ri}:${ci}`) && "ring-2 ring-red-300")} />
                      </td>
                    );
                  })}
                  <td className="border-b border-slate-100 px-1 text-right">
                    {uncertainRows[ri] && <button className="btn-secondary px-2 py-1 text-xs" onClick={() => onPatch({ verify_rows: [ri] })} title="I've checked this row against the image">Checked</button>}
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => toggleIgnore(ri)}>{ignored.has(ri) ? "Use" : "Ignore"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn-ghost mt-2 text-xs" onClick={() => onPatch({ add_row: true })}><Plus size={13} />Add a missing row</button>
        </div>
      </div>
      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={() => setZoom(false)}>
          <img src={api.fileUrl(up.id)} alt="" className="max-h-full max-w-full rounded-lg bg-white" />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ matching */

const STATUS_CHIP: Record<Match["status"], string> = {
  auto: "bg-emerald-50 text-emerald-700", new: "bg-sky-50 text-sky-700", confirmed: "bg-emerald-50 text-emerald-700",
  suggested: "bg-amber-50 text-amber-800", unmatched: "bg-red-50 text-red-700", ignored: "bg-slate-100 text-slate-500",
};
const STATUS_TEXT: Record<Match["status"], string> = {
  auto: "Matched", new: "New from CSV", confirmed: "Confirmed", suggested: "Needs confirmation", unmatched: "No match", ignored: "Ignored",
};

export function MatchPanel({ preview, onDecide }: { preview: Preview; onDecide: (body: Record<string, unknown>) => void }) {
  const [all, setAll] = useState(false);
  const list = preview.matches.filter((m) => all || !["auto", "new"].includes(m.status) || m.source !== "csv");
  const open = preview.matches.filter((m) => m.status === "suggested" || m.status === "unmatched").length;
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Name matching</h3>
          <p className="text-xs text-slate-500">Exact names and emails match automatically. Similar names are only suggestions: confirm each one. Confirmed spellings are remembered.</p>
        </div>
        <div className="flex items-center gap-3">
          {open > 0 && <span className="chip bg-amber-50 text-amber-800">{open} to confirm</span>}
          <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Show CSV names too</label>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead><tr><th className="th">Name in file</th><th className="th">Source</th><th className="th">Status</th><th className="th">Agent</th><th className="th" /></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={5} className="td text-slate-500">No screenshot names yet.</td></tr>}
            {list.map((m) => <MatchRow key={m.key} m={m} preview={preview} onDecide={onDecide} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatchRow({ m, preview, onDecide }: { m: Match; preview: Preview; onDecide: (b: Record<string, unknown>) => void }) {
  const [pick, setPick] = useState<number | "">(m.candidates[0]?.agent_id ?? "");
  const pending = m.status === "suggested" || m.status === "unmatched";
  const others = preview.agents.filter((a) => !m.candidates.some((c) => c.agent_id === a.id));
  return (
    <tr className={pending ? "bg-amber-50/40" : ""}>
      <td className="td font-medium">{m.name}{m.email && <div className="text-xs font-normal text-slate-500">{m.email}</div>}</td>
      <td className="td text-xs text-slate-600">{m.source_label}{m.rows.length ? ` · row ${m.rows.map((r) => r + 1).join(", ")}` : ""}</td>
      <td className="td"><span className={classNames("chip", STATUS_CHIP[m.status])}>{STATUS_TEXT[m.status]}</span>
        {m.status === "suggested" && <div className="mt-0.5 text-[11px] text-slate-500">{m.reason}</div>}</td>
      <td className="td">
        {pending ? (
          <select className="input py-1.5" value={pick} onChange={(e) => setPick(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Choose agent…</option>
            {m.candidates.length > 0 && <optgroup label="Suggested">{m.candidates.map((c) => <option key={c.agent_id} value={c.agent_id}>{c.name} ({Math.round(c.score * 100)}%)</option>)}</optgroup>}
            <optgroup label="All agents">{others.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
          </select>
        ) : <span className="text-sm">{m.agent_name ?? "-"}</span>}
      </td>
      <td className="td text-right">
        {pending ? (
          <div className="flex justify-end gap-1.5">
            <button className="btn-primary px-2.5 py-1 text-xs" disabled={pick === ""} onClick={() => onDecide({ key: m.key, action: "link", agent_id: pick, name: m.name })}>Confirm</button>
            <button className="btn-secondary px-2 py-1 text-xs" onClick={() => onDecide({ key: m.key, action: "new", name: m.name, role: "setter" })}><UserPlus size={12} />New setter</button>
            <button className="btn-secondary px-2 py-1 text-xs" onClick={() => onDecide({ key: m.key, action: "new", name: m.name, role: "closer" })}><UserPlus size={12} />New closer</button>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => onDecide({ key: m.key, action: "ignore" })}>Ignore</button>
          </div>
        ) : (m.status === "confirmed" || m.status === "ignored") && (
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => onDecide({ key: m.key, action: "reset" })}>Undo</button>
        )}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------ roles */

export function RolesPanel({ rows, onRole }: { rows: Row[]; onRole: (agentId: number, role: string) => void }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Setters and closers</h3>
        <p className="text-xs text-slate-500">Taken from the CSV team column where it says setter/closer (keywords in Settings), otherwise from your choice. Reassign anyone here; it applies from now on.</p>
      </div>
      <div className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <div key={r.agent_id} className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-900">{r.name}</div>
              <div className="text-[11px] text-slate-500">{r.role_source ?? "not set"}</div>
            </div>
            <select className={classNames("input py-1 text-xs", r.role === "unassigned" && "border-red-300 bg-red-50")} value={r.role === "unassigned" ? "" : r.role}
              onChange={(e) => onRole(r.agent_id, e.target.value)}>
              <option value="" disabled>Choose…</option>
              <option value="setter">Setter</option>
              <option value="closer">Closer</option>
              <option value="excluded">Exclude from report</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
