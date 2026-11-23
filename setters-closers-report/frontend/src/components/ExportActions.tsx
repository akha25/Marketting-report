import { useState } from "react";
import { Camera, ClipboardCopy, FileSpreadsheet, FileText, FileDown, RotateCcw, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { capturePng, copyImage, downloadDataUrl, downloadPdf } from "../lib/capture";
import type { Report } from "../lib/types";
import { slackSummary } from "../lib/util";

interface Props {
  report: Report;
  canvas: React.RefObject<HTMLDivElement>;
  snapshotId?: number | null;
  sessionId?: number;
  draft?: boolean;
  onGenerate?: () => Promise<void>;
  canGenerate?: boolean;
  onReset?: () => Promise<void>;
}

export default function ExportActions({ report, canvas, snapshotId, sessionId, draft, onGenerate, canGenerate, onReset }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const s = report.session;
  const base = `setters-closers_${s?.date ?? ""}_${(s?.slot ?? "").replace(":", "")}${report.version ? `_v${report.version}` : "_draft"}`;

  const run = async (name: string, fn: () => Promise<string | void>) => {
    setBusy(name);
    setMsg(null);
    try {
      const t = await fn();
      if (t) setMsg({ ok: true, text: t });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const fileUrl = (fmt: "csv" | "xlsx") => (snapshotId && !draft ? api.snapshotExport(snapshotId, fmt) : sessionId ? api.sessionExport(sessionId, fmt) : "#");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {onGenerate && (
          <button className="btn-primary" disabled={!canGenerate || !!busy} onClick={() => run("gen", async () => { await onGenerate(); return "Report generated and saved to history."; })}
            title={canGenerate ? "" : "Fix the items on Upload Reports first"}>
            <Sparkles size={16} /> Generate Report
          </button>
        )}
        <a className="btn-secondary" href={fileUrl("csv")}><FileText size={16} /> Download CSV</a>
        <a className="btn-secondary" href={fileUrl("xlsx")}><FileSpreadsheet size={16} /> Download Excel</a>
        <button className="btn-secondary" disabled={!!busy} onClick={() => run("pdf", async () => {
          if (!canvas.current) throw new Error("Report not ready.");
          await downloadPdf(canvas.current, `${base}.pdf`);
        })}><FileDown size={16} /> {busy === "pdf" ? "Making PDF…" : "Download PDF"}</button>
        <button className="btn-secondary" disabled={!!busy} onClick={() => run("copy", async () => {
          await navigator.clipboard.writeText(slackSummary(report));
          return "Summary copied. Paste it into Slack.";
        })}><ClipboardCopy size={16} /> Copy Report Summary</button>
        <button className="btn-primary bg-slate-900 hover:bg-slate-800" disabled={!!busy} onClick={() => run("shot", async () => {
          if (!canvas.current) throw new Error("Report not ready.");
          const url = await capturePng(canvas.current);
          downloadDataUrl(url, `${base}.png`);
          const copied = await copyImage(url);
          return copied ? "Screenshot downloaded and copied. Paste it straight into Slack (Ctrl/Cmd+V)." : "Screenshot downloaded. Drag the PNG into Slack.";
        })}><Camera size={16} /> {busy === "shot" ? "Capturing…" : "Capture Full Report Screenshot"}</button>
        {onReset && (
          <button className="btn-danger" disabled={!!busy} onClick={() => {
            if (confirm("Clear this session's uploads and decisions? Generated versions stay in history.")) run("reset", async () => { await onReset(); return "Uploads cleared for this session."; });
          }}><RotateCcw size={16} /> Reset Uploads</button>
        )}
      </div>
      {draft && <p className="text-xs text-amber-700">This is a draft: exports are labelled DRAFT until you generate the report.</p>}
      {msg && <p className={msg.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}>{msg.text}</p>}
    </div>
  );
}
