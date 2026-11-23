import { useRef } from "react";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import ExportActions from "../components/ExportActions";
import ReportCanvas from "../components/ReportCanvas";
import { EmptyState, Page, useReport } from "./ReportPages";

export default function ExportReports() {
  const { session, view, preview, apply } = useSession();
  const { report, draft, empty } = useReport();
  const canvas = useRef<HTMLDivElement>(null);
  if (!session || !view || !report) return <Page title="Export Reports"><div className="text-sm text-slate-500">Loading…</div></Page>;
  return (
    <Page title="Export Reports">
      <div className="card p-4">
        <ExportActions report={report} canvas={canvas} snapshotId={view.snapshot_id} sessionId={session.id} draft={draft}
          canGenerate={!!preview?.can_finalize && draft}
          onGenerate={async () => { await api.finalize(session.id); await apply(await api.preview(session.id)); }}
          onReset={async () => { await apply(await api.reset(session.id)); }} />
      </div>
      {empty ? <EmptyState /> : (
        <div>
          <p className="mb-2 text-xs text-slate-500">This is exactly what the screenshot, PDF and Slack image contain (1280 px wide, captured at 2× for sharp text).</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-100 p-4">
            <div className="mx-auto w-fit shadow-lg"><ReportCanvas ref={canvas} report={report} draft={draft} /></div>
          </div>
        </div>
      )}
    </Page>
  );
}
