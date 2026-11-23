import { NavLink, Outlet } from "react-router-dom";
import { BarChart3, CalendarClock, Download, History, LayoutDashboard, PhoneCall, Settings, Target, Upload, Users } from "lucide-react";
import { useSession } from "../lib/session";
import { classNames, fmtDateTime } from "../lib/util";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/upload", label: "Upload Reports", icon: Upload },
  { to: "/setters", label: "Setters Performance", icon: PhoneCall },
  { to: "/closers", label: "Closers Performance", icon: Target },
  { to: "/bookings", label: "Booking Report", icon: BarChart3 },
  { to: "/history", label: "Historical Reports", icon: History },
  { to: "/export", label: "Export Reports", icon: Download },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function Layout() {
  const { date, setDate, slot, setSlot, settings, session, preview, error } = useSession();
  const latest = session?.snapshots[session.snapshots.length - 1];
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <img src="/favicon.svg" className="h-8 w-8" alt="" />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-900">Setters & Closers</div>
            <div className="text-xs text-slate-500">Daily reporting</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => classNames("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")}>
              <Icon size={17} strokeWidth={1.8} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 px-5 py-4 text-xs text-slate-500">
          <Users size={13} className="mr-1 inline" /> Times in IST (Asia/Kolkata)
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
            <h1 className="text-base font-semibold text-slate-900">{settings?.report_title ?? "Daily Setters & Closers Performance Report"}</h1>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <CalendarClock size={16} className="text-slate-400" />
              <input type="date" className="input py-1.5" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Report date" />
              <div className="flex rounded-lg border border-slate-300 bg-slate-50 p-0.5" role="radiogroup" aria-label="Reporting session">
                {settings?.slots.map((s) => (
                  <button key={s.value} role="radio" aria-checked={slot === s.value} onClick={() => setSlot(s.value)}
                    className={classNames("rounded-md px-3 py-1 text-sm font-medium",
                      slot === s.value ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900")}>
                    {s.label}
                  </button>
                ))}
              </div>
              {session && (
                session.status === "final" && latest
                  ? <span className="chip bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">Generated v{latest.version} · {fmtDateTime(latest.generated_at)}</span>
                  : latest
                    ? <span className="chip bg-amber-50 text-amber-800 ring-1 ring-amber-200">Edited after v{latest.version}</span>
                    : <span className="chip bg-slate-100 text-slate-600">Draft{preview ? ` · ${preview.counts.errors} to fix` : ""}</span>
              )}
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-4 pb-2 lg:hidden">
            {NAV.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end}
                className={({ isActive }) => classNames("whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium",
                  isActive ? "bg-brand-50 text-brand-700" : "text-slate-600")}>{label}</NavLink>
            ))}
          </nav>
        </header>
        {error && <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
        <main className="px-6 py-6"><Outlet /></main>
      </div>
    </div>
  );
}
