import type { Card } from "../lib/types";
import { classNames } from "../lib/util";

export default function SummaryCards({ cards, compact }: { cards: Card[]; compact?: boolean }) {
  return (
    <div className={classNames("grid gap-3", compact ? "grid-cols-4" : "grid-cols-2 md:grid-cols-4 xl:grid-cols-4")}>
      {cards.map((c) => (
        <div key={c.label} className={classNames("rounded-xl border border-slate-200 bg-white", compact ? "px-3 py-2" : "px-4 py-3 shadow-sm")} title={c.hint}>
          <div className="text-xs font-medium text-slate-500">{c.label}</div>
          <div className={classNames("mt-1 font-semibold tabular-nums", c.value === "N/A" ? "text-slate-400" : "text-slate-900", compact ? "text-lg" : "text-2xl")}>
            {c.value}
            {c.unit && c.value !== "N/A" && <span className="ml-1 text-sm font-normal text-slate-500">{c.unit}</span>}
          </div>
          {c.hint && !compact && <div className="mt-0.5 truncate text-[11px] text-slate-400">{c.hint}</div>}
        </div>
      ))}
    </div>
  );
}
