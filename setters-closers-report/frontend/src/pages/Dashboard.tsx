import { useState } from "react";
import { useReport, EmptyState, Page } from "./ReportPages";
import SummaryCards from "../components/SummaryCards";
import { ChartCard, MetricBarChart } from "../components/Charts";
import ReportTable, { Legend } from "../components/ReportTable";
import { sortRows } from "../lib/util";

export default function Dashboard() {
  const { report, empty } = useReport();
  const [setterKey, setSetterKey] = useState("");
  const [closerKey, setCloserKey] = useState("");
  if (!report || empty) return <Page title="Dashboard"><EmptyState /></Page>;
  const m = (k: string) => report.metrics.find((x) => x.key === k);
  const sk = m(setterKey || report.sorting.primary) ?? report.metrics[0];
  const ck = m(closerKey || report.sorting.primary) ?? report.metrics[0];
  const all = [...report.setters.rows, ...report.closers.rows];
  const picker = (value: string, set: (v: string) => void) => (
    <select className="input py-1 text-xs" value={value} onChange={(e) => set(e.target.value)} aria-label="Metric">
      {report.metrics.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
    </select>
  );
  return (
    <Page title="Dashboard" actions={<Legend formatting={report.formatting} />}>
      <SummaryCards cards={report.summary.cards} />
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Setter performance comparison" subtitle={`${sk.label} by setter`} action={picker(sk.key, setSetterKey)}>
          <MetricBarChart rows={sortRows(report.setters.rows, sk.key)} metric={sk} />
        </ChartCard>
        <ChartCard title="Closer performance comparison" subtitle={`${ck.label} by closer`} action={picker(ck.key, setCloserKey)}>
          <MetricBarChart rows={sortRows(report.closers.rows, ck.key)} metric={ck} />
        </ChartCard>
        {m("bookings") && (
          <ChartCard title="Booking distribution" subtitle="Bookings per agent across both teams">
            <MetricBarChart rows={all} metric={m("bookings")!} horizontal height={260} />
          </ChartCard>
        )}
        {m("talk_time") && (
          <ChartCard title="Talk Time comparison" subtitle="Minutes per agent; dashed line is the target">
            <MetricBarChart rows={all} metric={m("talk_time")!} />
          </ChartCard>
        )}
        {m("host_time") && (
          <ChartCard title="Host Time comparison" subtitle="Minutes per agent; dashed line is the target">
            <MetricBarChart rows={all} metric={m("host_time")!} />
          </ChartCard>
        )}
      </div>
      <div className="grid gap-4 2xl:grid-cols-2">
        <ReportTable title="Setters (top 5)" section={{ ...report.setters, rows: report.setters.rows.slice(0, 5) }} metrics={report.metrics} formatting={report.formatting} />
        <ReportTable title="Closers (top 5)" section={{ ...report.closers, rows: report.closers.rows.slice(0, 5) }} metrics={report.metrics} formatting={report.formatting} />
      </div>
    </Page>
  );
}
