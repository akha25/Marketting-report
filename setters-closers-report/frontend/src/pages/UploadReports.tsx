import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Loader2, PlayCircle, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import type { Kind, Preview } from "../lib/types";
import { classNames, fmtDate } from "../lib/util";
import { CsvMapping, IssuesPanel, MatchPanel, RolesPanel, ScreenshotReview, UploadCard } from "../components/review";
import ReportTable, { Legend } from "../components/ReportTable";
import { CLOSER_COLOR, SETTER_COLOR } from "../components/Charts";

const CARDS: { kind: Kind; title: string; subtitle: string; accept: string }[] = [
  { kind: "csv", title: "Dialer CSV", subtitle: "FreJun export for this session", accept: ".csv" },
  { kind: "booking", title: "Booking screenshot", subtitle: "Agent names and booking counts", accept: ".png,.jpg,.jpeg" },
  { kind: "cc", title: "CC screenshot", subtitle: "CC report for this session", accept: ".png,.jpg,.jpeg" },
];

export default function UploadReports() {
  const { session, preview, apply, health, loading } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  if (!session || !preview) return <div className="text-sm text-slate-500">{loading ? "Loading session…" : "Choose a date and session above."}</div>;
  const sid = session.id;

  const run = async (name: string, fn: () => Promise<Preview | void>) => {
    setBusy(name);
    setErr(null);
    try {
      const p = await fn();
      if (p) await apply(p);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const patch = (uid: number) => (body: Record<string, unknown>) => run("patch", () => api.patchUpload(uid, body));
  const role = (agentId: number, r: string) => run("role", async () => { await api.updateAgent(agentId, { role: r }); return api.preview(sid); });

  const ups = preview.uploads;
  const unread = (["booking", "cc"] as Kind[]).filter((k) => ups[k] && !ups[k]!.processed && !ups[k]!.error).length;
  const anyUpload = Object.keys(ups).length > 0;
  const rep = preview.report;
  const roleRows = [...rep.unassigned, ...rep.setters.rows, ...rep.closers.rows];
  const step = !anyUpload ? 2 : unread ? 3 : preview.can_finalize ? 5 : 4;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Upload Reports</h2>
          <p className="text-sm text-slate-500">{fmtDate(session.date)} · <b>{session.slot_label}</b> session. Each session keeps its own files and versions.</p>
        </div>
        <ol className="flex flex-wrap gap-1.5 text-xs">
          {["Session", "Upload", "Process", "Verify", "Generate"].map((s, i) => (
            <li key={s} className={classNames("chip", i + 1 < step ? "bg-emerald-50 text-emerald-700" : i + 1 === step ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-500")}>{i + 1}. {s}</li>
          ))}
        </ol>
      </div>

      {health && health.ocr_provider !== "anthropic" && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-900">
          Screenshots are read with the free OCR (Tesseract). For app screenshots, set <code>ANTHROPIC_API_KEY</code> to use Claude's image reading, which is far more accurate.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {CARDS.map((c) => (
          <UploadCard key={c.kind} {...c} upload={ups[c.kind]} busy={busy === `up-${c.kind}`}
            onFile={(f) => run(`up-${c.kind}`, async () => {
              const r = await api.upload(sid, c.kind, f);
              if (r.duplicate_of_current) setErr(`"${f.name}" is the same file already uploaded here; nothing changed.`);
              return r.preview;
            })} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary px-5 py-2.5" disabled={!anyUpload || !!busy} onClick={() => run("process", () => api.process(sid))}>
          {busy === "process" ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
          {busy === "process" ? "Reading screenshots…" : "Process Reports"}
        </button>
        <span className="text-sm text-slate-500">
          {unread ? `${unread} screenshot${unread > 1 ? "s" : ""} waiting to be read.` : anyUpload ? "All uploaded files are read. Review below." : "Upload at least the dialer CSV."}
        </span>
        {busy && busy !== "process" && <Loader2 size={16} className="animate-spin text-slate-400" />}
      </div>
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">{err}</div>}

      {anyUpload && (
        <>
          <IssuesPanel issues={preview.issues}
            onAck={(uid) => patch(uid)({ options: { ack_duplicate: true } })}
            onPolicy={(uid, p) => patch(uid)({ options: { duplicate_policy: p } })}
            onIgnoreRow={(uid, row) => patch(uid)({ options: { ignored_rows: [...(Object.values(ups).find((u) => u!.id === uid)?.options.ignored_rows ?? []), row] } })}
            onRole={role} />

          {ups.csv?.processed && <CsvMapping up={ups.csv} onPatch={patch(ups.csv.id)} />}
          {(["booking", "cc"] as Kind[]).map((k) => ups[k] && (
            <ScreenshotReview key={k} up={ups[k]!} issues={preview.issues} onPatch={patch(ups[k]!.id)}
              onReread={(p) => run("reread", () => api.reextract(ups[k]!.id, p))} />
          ))}
          <MatchPanel preview={preview} onDecide={(b) => run("decide", () => api.decide(sid, b))} />
          {roleRows.length > 0 && <RolesPanel rows={roleRows} onRole={role} />}

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-slate-900">Preview</h3>
              <Legend formatting={rep.formatting} />
            </div>
            <ReportTable title="Setters Performance" section={rep.setters} metrics={rep.metrics} formatting={rep.formatting} accent={SETTER_COLOR} />
            <ReportTable title="Closers Performance" section={rep.closers} metrics={rep.metrics} formatting={rep.formatting} accent={CLOSER_COLOR} />
          </div>

          <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="text-sm">
              {preview.can_finalize
                ? <span className="text-emerald-700">All checks passed. Generating saves this as version {session.snapshots.length + 1} for the {session.slot_label} session.</span>
                : <span className="text-red-700">{preview.counts.errors} item{preview.counts.errors === 1 ? "" : "s"} to fix above before the report can be generated.</span>}
              {preview.counts.warnings > 0 && <span className="ml-2 text-amber-700">({preview.counts.warnings} warning{preview.counts.warnings > 1 ? "s" : ""} to review)</span>}
            </div>
            <div className="flex gap-2">
              {done && <Link to="/export" className="btn-secondary">Capture Screenshot <ArrowRight size={15} /></Link>}
              <button className="btn-primary px-5 py-2.5" disabled={!preview.can_finalize || !!busy}
                onClick={() => run("final", async () => { const r = await api.finalize(sid); setDone(r.version); return api.preview(sid); })}>
                <Sparkles size={16} /> Generate Final Report
              </button>
            </div>
          </div>
          {done && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Version {done} saved. Next: <Link to="/export" className="font-semibold underline">Export Reports → Capture Full Report Screenshot</Link> and paste it into Slack.
          </div>}
        </>
      )}
    </div>
  );
}
