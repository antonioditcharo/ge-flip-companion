import Link from "next/link";
import { ArrowLeft, BarChart3, CheckCircle2, Target, TrendingUp } from "lucide-react";
import { sql } from "@/lib/db";
import { formatGp } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function RecommendationAnalyticsPage() {
  const [batchRows, summaryRows, classificationRows, rankRows] = await Promise.all([
    sql`select count(*)::int batches,coalesce(sum(recommendation_count),0)::int recommendations,max(generated_at) latest_batch_at from recommendation_batches`,
    sql`select count(*)::int recommendations,count(trade_id)::int acted_on,count(*) filter(where trade_status='COMPLETED')::int completed,coalesce(sum(realized_profit) filter(where trade_status='COMPLETED'),0)::bigint realized_profit,coalesce(sum(expected_profit) filter(where trade_status='COMPLETED'),0)::bigint expected_profit,coalesce(avg(abs(profit_error)) filter(where trade_status='COMPLETED'),0)::numeric average_absolute_error from recommendation_outcomes`,
    sql`select coalesce(classification,'Unclassified') classification,count(*)::int recommendations,count(trade_id)::int acted_on,count(*) filter(where trade_status='COMPLETED')::int completed,coalesce(sum(realized_profit) filter(where trade_status='COMPLETED'),0)::bigint realized_profit,coalesce(avg(realized_roi) filter(where trade_status='COMPLETED'),0)::numeric realized_roi from recommendation_outcomes group by classification order by realized_profit desc`,
    sql`select rank,count(*)::int recommendations,count(trade_id)::int acted_on,count(*) filter(where trade_status='COMPLETED')::int completed,coalesce(sum(realized_profit) filter(where trade_status='COMPLETED'),0)::bigint realized_profit from recommendation_outcomes where rank is not null group by rank order by rank limit 10`,
  ]);
  const batch=batchRows[0]??{},summary=summaryRows[0]??{};
  const recommendations=Number(summary.recommendations??0),acted=Number(summary.acted_on??0),completed=Number(summary.completed??0);
  const conversion=recommendations?acted/recommendations*100:0;
  return <div className="space-y-5">
    <section className="rounded-3xl border border-stone-800 bg-[#141a17] p-6">
      <Link href="/analytics" className="inline-flex items-center gap-2 text-sm text-stone-400 hover:text-amber-300"><ArrowLeft size={16}/>Back to analytics</Link>
      <div className="mt-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300"><BarChart3 size={24}/></div>
      <h1 className="mt-4 text-3xl font-bold">Recommendation outcomes</h1>
      <p className="mt-2 text-sm text-stone-400">Expected versus realized performance for persisted recommendation batches.</p>
    </section>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card icon={<Target size={16}/>} label="Recommendations" value={Number(batch.recommendations??0).toLocaleString()}/>
      <Card icon={<TrendingUp size={16}/>} label="Acted on" value={`${acted.toLocaleString()} (${conversion.toFixed(1)}%)`}/>
      <Card icon={<CheckCircle2 size={16}/>} label="Completed linked trades" value={completed.toLocaleString()}/>
      <Card icon={<BarChart3 size={16}/>} label="Realized profit" value={formatGp(String(summary.realized_profit??0))}/>
    </section>
    <section className="rounded-2xl border border-stone-800 bg-[#141a17] p-5"><h2 className="text-lg font-semibold">Forecast calibration</h2><div className="mt-4 grid gap-3 sm:grid-cols-3"><Stat label="Expected profit" value={formatGp(String(summary.expected_profit??0))}/><Stat label="Realized profit" value={formatGp(String(summary.realized_profit??0))}/><Stat label="Average absolute error" value={formatGp(String(Math.round(Number(summary.average_absolute_error??0))))}/></div><p className="mt-4 text-xs text-stone-500">Batches: {String(batch.batches??0)} · Latest: {batch.latest_batch_at?new Date(String(batch.latest_batch_at)).toLocaleString("en-US"):"None"}</p></section>
    <section className="grid gap-5 xl:grid-cols-2"><Panel title="By classification" rows={classificationRows} group="classification"/><Panel title="Top ranks" rows={rankRows} group="rank"/></section>
  </div>;
}
function Card({icon,label,value}:{icon:React.ReactNode;label:string;value:string}){return <article className="rounded-2xl border border-stone-800 bg-[#141a17] p-4"><p className="flex items-center gap-2 text-xs text-stone-500">{icon}{label}</p><p className="mt-2 text-xl font-semibold">{value}</p></article>}
function Stat({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-stone-950/50 p-3"><p className="text-xs text-stone-500">{label}</p><p className="mt-1 font-semibold">{value}</p></div>}
function Panel({title,rows,group}:{title:string;rows:Record<string,unknown>[];group:string}){return <section className="rounded-2xl border border-stone-800 bg-[#141a17] p-5"><h2 className="text-lg font-semibold">{title}</h2><div className="mt-4 space-y-3">{rows.length===0?<p className="text-sm text-stone-500">No linked outcomes yet.</p>:rows.map((row,index)=><div key={index} className="rounded-xl bg-stone-950/40 p-3"><div className="flex justify-between"><span>{String(row[group])}</span><span className="text-emerald-300">{formatGp(String(row.realized_profit??0))}</span></div><p className="mt-1 text-xs text-stone-500">{String(row.acted_on)} acted on · {String(row.completed)} completed · {String(row.recommendations)} generated</p></div>)}</div></section>}
