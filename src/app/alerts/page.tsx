import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { sql } from "@/lib/db";
import { formatGp, formatStatus } from "@/lib/utils";
import { refreshAlerts, updateAlert } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  refreshed?: string;
  updated?: string;
  refreshError?: string;
  error?: string;
}>;

type AlertRow = Record<string, unknown>;

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function date(value: unknown) {
  if (!value) return "Not available";
  return new Date(String(value)).toLocaleString("en-US", {
    timeZone: "America/Anchorage",
  });
}

function isGuardian(row: AlertRow) {
  return Boolean(row.guidance_id);
}

function severityClass(value: unknown) {
  const severity = String(value);
  if (severity === "CRITICAL") return "border-red-800/60 bg-red-950/20 text-red-200";
  if (severity === "WARNING") return "border-amber-800/60 bg-amber-950/20 text-amber-200";
  return "border-stone-700 bg-stone-950/30 text-stone-300";
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const rows = (await sql`
    select
      alert.*,
      item.name,
      trade.slot_number,
      trade.status as trade_status,
      guidance.side as guidance_side,
      guidance.guidance_status,
      guidance.recommended_price,
      guidance.recommended_quantity,
      guidance.break_even_price,
      guidance.quote_age_minutes,
      guidance.evaluated_at as guidance_evaluated_at
    from alerts alert
    left join items item on item.id=alert.item_id
    left join trades trade on trade.id=alert.trade_id
    left join trade_guidance guidance on guidance.id=alert.guidance_id
    where not alert.is_resolved
    order by
      case alert.severity when 'CRITICAL' then 1 when 'WARNING' then 2 else 3 end,
      alert.created_at desc
  `) as AlertRow[];

  const unread = rows.filter((row) => !Boolean(row.is_read)).length;
  const guardianCount = rows.filter(isGuardian).length;
  const legacyCount = rows.length - guardianCount;

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-stone-800 bg-[#141a17] p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300">
              <Bell size={24} aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-3xl font-bold">Alerts</h1>
            <p className="mt-2 text-sm text-stone-400">
              {unread} unread. {guardianCount} Guardian and {legacyCount} operational alerts require review.
            </p>
          </div>
          <form action={refreshAlerts}>
            <button className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-3 text-sm font-semibold text-stone-950 hover:bg-amber-300">
              <RefreshCw size={16} aria-hidden="true" />
              Refresh market, Guardian, and alerts
            </button>
          </form>
        </div>
      </section>

      {params.refreshed === "1" && <Notice>Market observations, Guardian guidance, and operational alerts refreshed.</Notice>}
      {params.updated === "1" && <Notice>Alert status updated.</Notice>}
      {params.refreshError === "1" && (
        <p role="alert" className="rounded-2xl border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-200">
          Refresh failed. Check the server log, database schema, and OSRS_USER_AGENT configuration.
        </p>
      )}
      {params.error === "invalid" && (
        <p role="alert" className="rounded-2xl border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-200">
          The alert update was invalid.
        </p>
      )}

      {rows.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-stone-700 bg-stone-950/30 p-8 text-center text-stone-400">
          <CheckCircle2 className="mx-auto text-emerald-300" aria-hidden="true" />
          <p className="mt-3">No unresolved alerts.</p>
        </section>
      ) : (
        <section className="space-y-3">
          {rows.map((row) => {
            const guardian = isGuardian(row);
            return (
              <article key={String(row.id)} className={`rounded-2xl border p-5 ${severityClass(row.severity)}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {guardian ? <ShieldAlert size={17} aria-hidden="true" /> : <AlertTriangle size={17} aria-hidden="true" />}
                      <span className="rounded-full bg-stone-950/50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide">
                        {guardian ? "Guardian" : "Operational"}
                      </span>
                      <span className="text-xs uppercase tracking-wide opacity-70">{String(row.severity)}</span>
                    </div>
                    <h2 className="mt-3 text-lg font-semibold">{String(row.title)}</h2>
                    <p className="mt-1 text-xs opacity-70">
                      {row.name ? String(row.name) : "Portfolio"}
                      {row.slot_number ? ` · GE slot ${String(row.slot_number)}` : ""}
                      {row.trade_status ? ` · ${formatStatus(String(row.trade_status))}` : ""}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs opacity-60">
                    <Clock3 size={13} aria-hidden="true" />
                    {date(row.created_at)}
                  </span>
                </div>

                <p className="mt-4 text-sm text-stone-200">{String(row.message)}</p>
                <p className="mt-3 rounded-xl bg-stone-950/40 p-3 text-sm">
                  <span className="font-semibold">Next:</span> {String(row.recommended_action ?? "Review the trade.")}
                </p>

                {guardian && (
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <Metric label="Side / status" value={`${String(row.guidance_side)} · ${formatStatus(String(row.guidance_status))}`} />
                    <Metric label="Recommended price" value={row.recommended_price == null ? "No price change" : formatGp(String(row.recommended_price))} />
                    <Metric label="Recommended quantity" value={number(row.recommended_quantity).toLocaleString()} />
                    <Metric label="Break-even / quote age" value={`${row.break_even_price == null ? "N/A" : formatGp(String(row.break_even_price))} · ${Math.round(number(row.quote_age_minutes))} min`} />
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2 border-t border-current/10 pt-4">
                  {!Boolean(row.is_read) && <AlertAction id={String(row.id)} mode="read" label="Mark read" />}
                  <AlertAction id={String(row.id)} mode="resolve" label="Resolve" />
                  {Boolean(row.trade_id) && (
                    <Link href="/trades" className="inline-flex items-center gap-2 rounded-lg border border-stone-600 px-3 py-2 text-xs font-semibold hover:bg-stone-950/40">
                      Open active trades <ExternalLink size={13} aria-hidden="true" />
                    </Link>
                  )}
                </div>

                {guardian && <p className="mt-3 text-[11px] opacity-60">Guidance evaluated {date(row.guidance_evaluated_at)}. CoFlipper does not change the in-game order.</p>}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}

function AlertAction({ id, mode, label }: { id: string; mode: "read" | "resolve"; label: string }) {
  return (
    <form action={updateAlert}>
      <input type="hidden" name="alertId" value={id} />
      <input type="hidden" name="mode" value={mode} />
      <button className="rounded-lg border border-stone-600 px-3 py-2 text-xs font-semibold hover:bg-stone-950/40">{label}</button>
    </form>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-stone-950/40 p-3"><p className="opacity-60">{label}</p><p className="mt-1 font-semibold text-stone-100">{value}</p></div>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p role="status" className="rounded-2xl border border-emerald-800/50 bg-emerald-950/30 p-4 text-sm text-emerald-200">{children}</p>;
}
