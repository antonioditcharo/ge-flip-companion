import Link from "next/link";
import type { Metadata } from "next";
import { Activity, CheckCircle2, Clock3, Database, ShieldCheck, TriangleAlert } from "lucide-react";
import { existsSync } from "node:fs";
import { sql } from "@/lib/db";

export const metadata: Metadata = { title: "Pipeline Operations" };
export const dynamic = "force-dynamic";

const REQUIRED_DAYS = 20;
const HEALTHY_AFTER_MINUTES = 45;
const STALE_AFTER_MINUTES = 90;

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function formatNumber(value: unknown) { return asNumber(value).toLocaleString("en-US"); }
function formatDate(value: unknown) {
  if (!value) return "Not available";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString("en-US", { timeZone: "America/Anchorage" });
}
function percent(value: number) { return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`; }

export default async function OperationsPage() {
  const [latestRuns, bars, eligibility, dataset] = await Promise.all([
    sql`select id,status,timestep,requested_items,completed_items,failed_items,bars_upserted,started_at,completed_at from market_ingestion_runs order by id desc limit 8`,
    sql`select count(*)::bigint as bars,count(distinct item_id)::int as items,min(bucket_at) as first_bar,max(bucket_at) as last_bar,extract(epoch from (now() - max(bucket_at))) / 60.0 as last_bar_age_minutes from market_bars where timestep='5m'`,
    sql`select eligible,reason,count(*)::int as items,avg(quality_score)::float8 as average_quality,avg(coverage_ratio)::float8 as average_coverage from model_item_eligibility where timestep='5m' group by eligible,reason order by eligible desc,reason`,
    sql`select count(*)::bigint as rows,count(distinct item_id)::int as items,min(bucket_at) as first_at,max(bucket_at) as last_at,count(*) filter(where history_contiguous_1h)::bigint as contiguous_rows,count(*) filter(where target_return_240m is not null)::bigint as labeled_rows from ml_training_rows_5m`,
  ]);

  const run = latestRuns[0];
  const bar = bars[0];
  const data = dataset[0];
  const lastBarAge = bar?.last_bar ? asNumber(bar.last_bar_age_minutes) : Number.POSITIVE_INFINITY;
  const latestRunSucceeded =
    run?.status === "COMPLETED" &&
    asNumber(run?.failed_items) === 0;

  const pipelineStatus =
    !latestRunSucceeded ||
    lastBarAge > STALE_AFTER_MINUTES
      ? "stale"
      : lastBarAge > HEALTHY_AFTER_MINUTES
        ? "delayed"
        : "healthy";
  const eligibleItems = eligibility.filter((row) => row.eligible === true).reduce((sum, row) => sum + asNumber(row.items), 0);
  const firstAt = data?.first_at ? new Date(String(data.first_at)).getTime() : 0;
  const lastAt = data?.last_at ? new Date(String(data.last_at)).getTime() : firstAt;
  const availableDays = Math.max(0, (lastAt - firstAt) / 86_400_000);
  const maturity = Math.min(100, (availableDays / REQUIRED_DAYS) * 100);
  const foundationExists = existsSync("data/ml/ge-flip-5m-foundation-v2.csv");

  return <div className="space-y-6">
    <section className="rounded-2xl border border-stone-800 bg-[#141a17] p-6 shadow-xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">Operations</p><h1 className="mt-2 text-3xl font-bold">Market data pipeline</h1><p className="mt-2 max-w-2xl text-sm text-stone-400">Live ingestion health, model eligibility, dataset quality, and foundation readiness from Neon.</p><Link href="/operations/recommendations" className="mt-4 inline-flex items-center rounded-xl border border-amber-700/60 bg-amber-950/20 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-950/50">Recommendation pipeline</Link></div>
        <span
          className={`inline-flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-sm font-semibold ${
            pipelineStatus === "healthy"
              ? "border-emerald-700/50 bg-emerald-950/50 text-emerald-300"
              : pipelineStatus === "delayed"
                ? "border-amber-700/50 bg-amber-950/50 text-amber-300"
                : "border-red-700/50 bg-red-950/50 text-red-300"
          }`}
        >
          {pipelineStatus === "healthy" ? (
            <CheckCircle2 size={16} />
          ) : (
            <TriangleAlert size={16} />
          )}
          {pipelineStatus === "healthy"
            ? "Pipeline healthy"
            : pipelineStatus === "delayed"
              ? "Collector delayed"
              : "Pipeline stale"}
        </span>
      </div>
    </section>

    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Metric icon={Clock3} label="Latest 5m bar" value={formatDate(bar?.last_bar)} detail={`${Number.isFinite(lastBarAge) ? Math.round(lastBarAge) : "?"} minutes old`} good={lastBarAge <= HEALTHY_AFTER_MINUTES}/>
      <Metric icon={Database} label="5m market bars" value={formatNumber(bar?.bars)} detail={`${formatNumber(bar?.items)} tracked items`} good/>
      <Metric icon={Activity} label="Eligible items" value={formatNumber(eligibleItems)} detail="Current model-quality gate" good={eligibleItems > 0}/>
      <Metric icon={ShieldCheck} label="Foundation v2" value={foundationExists ? "Promoted" : "Collecting"} detail={foundationExists ? "Versioned dataset available" : `${availableDays.toFixed(1)} of ${REQUIRED_DAYS} days`} good={foundationExists}/>
    </section>

    <section className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
      <div className="rounded-2xl border border-stone-800 bg-[#141a17] p-5 shadow-xl">
        <div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Dataset maturity</h2><p className="text-sm text-stone-400">Time coverage toward the 20-day promotion gate</p></div><span className="text-xl font-bold text-amber-300">{percent(maturity)}</span></div>
        <div className="mt-5 h-3 overflow-hidden rounded-full bg-stone-800"><div className="h-full rounded-full bg-amber-400" style={{width: percent(maturity)}}/></div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><Mini label="Rows" value={formatNumber(data?.rows)}/><Mini label="Contiguous" value={formatNumber(data?.contiguous_rows)}/><Mini label="Labeled" value={formatNumber(data?.labeled_rows)}/><Mini label="Items" value={formatNumber(data?.items)}/></div>
        <p className="mt-4 text-xs text-stone-500">Coverage: {formatDate(data?.first_at)} to {formatDate(data?.last_at)} (Anchorage time)</p>
      </div>
      <div className="rounded-2xl border border-stone-800 bg-[#141a17] p-5 shadow-xl"><h2 className="text-lg font-semibold">Eligibility breakdown</h2><div className="mt-4 space-y-3">{eligibility.map((row) => <div key={`${row.eligible}-${row.reason}`} className="rounded-xl border border-stone-800 bg-stone-950/35 p-3"><div className="flex items-center justify-between"><span className={row.eligible ? "text-emerald-300" : "text-stone-300"}>{String(row.reason).replaceAll("_", " ")}</span><strong>{formatNumber(row.items)}</strong></div><p className="mt-1 text-xs text-stone-500">Quality {asNumber(row.average_quality).toFixed(4)} · Coverage {asNumber(row.average_coverage).toFixed(4)}</p></div>)}</div></div>
    </section>

    <section className="rounded-2xl border border-stone-800 bg-[#141a17] p-5 shadow-xl"><h2 className="text-lg font-semibold">Recent ingestion runs</h2><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-stone-800 text-xs uppercase tracking-wide text-stone-500"><tr><Th>Run</Th><Th>Status</Th><Th>Cadence</Th><Th>Completed</Th><Th>Failed</Th><Th>Upserted</Th><Th>Finished</Th></tr></thead><tbody>{latestRuns.map((row) => <tr key={String(row.id)} className="border-b border-stone-800/70 last:border-0"><Td>#{String(row.id)}</Td><Td><span className={row.status === "COMPLETED" ? "text-emerald-300" : "text-amber-300"}>{String(row.status)}</span></Td><Td>{String(row.timestep)}</Td><Td>{formatNumber(row.completed_items)} / {formatNumber(row.requested_items)}</Td><Td>{formatNumber(row.failed_items)}</Td><Td>{formatNumber(row.bars_upserted)}</Td><Td>{formatDate(row.completed_at)}</Td></tr>)}</tbody></table></div></section>
  </div>;
}
function Metric({icon:Icon,label,value,detail,good=false}:{icon:typeof Activity;label:string;value:string;detail:string;good?:boolean}){return <div className="rounded-2xl border border-stone-800 bg-[#141a17] p-5 shadow-xl"><div className="flex items-center gap-2 text-stone-400"><Icon size={17}/><span className="text-sm">{label}</span></div><p className="mt-3 text-2xl font-bold text-stone-100">{value}</p><p className={`mt-1 text-xs ${good ? "text-emerald-400" : "text-amber-400"}`}>{detail}</p></div>}
function Mini({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-stone-950/40 p-3"><p className="text-xs text-stone-500">{label}</p><p className="mt-1 font-semibold">{value}</p></div>}
function Th({children}:{children:React.ReactNode}){return <th className="px-3 py-3 font-medium">{children}</th>}
function Td({children}:{children:React.ReactNode}){return <td className="px-3 py-3 text-stone-300">{children}</td>}
