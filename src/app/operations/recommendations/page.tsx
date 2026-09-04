import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clock3, Database, Layers3, TriangleAlert } from "lucide-react";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

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

export default async function RecommendationOperationsPage() {
  const [latestRows, summaryRows, sourceRows] = await Promise.all([
    sql`
      select
        id,
        generated_at,
        market_observed_at,
        source,
        scoring_version,
        model_version,
        candidate_count,
        recommendation_count,
        extract(epoch from (now()-generated_at))/60 as batch_age_minutes,
        extract(epoch from (now()-market_observed_at))/60 as market_age_minutes
      from recommendation_batches
      order by generated_at desc
      limit 1
    `,
    sql`
      select
        count(*)::integer as batches,
        coalesce(sum(recommendation_count),0)::integer as generated,
        count(*) filter(where recommendation_count=0)::integer as empty_batches,
        (select count(*)::integer from recommendations where active) as active,
        (select count(*)::integer from recommendations where active and expires_at>now()) as unexpired,
        (select count(*)::integer from trades where recommendation_id is not null) as linked_trades
      from recommendation_batches
    `,
    sql`
      select source,count(*)::integer as batches,
        coalesce(sum(recommendation_count),0)::integer as recommendations,
        max(generated_at) as last_generated_at
      from recommendation_batches
      group by source
      order by max(generated_at) desc
    `,
  ]);

  const latest=latestRows[0];
  const summary=summaryRows[0]??{};
  const batchAge=number(latest?.batch_age_minutes);
  const marketAge=number(latest?.market_age_minutes);
  const hasRecommendations=number(latest?.recommendation_count)>0;
  const healthy=Boolean(latest)&&batchAge<=60&&marketAge<=30&&hasRecommendations;
  const state=!latest?"No batches":healthy?"Healthy":marketAge>30?"Market snapshot stale":!hasRecommendations?"Latest batch empty":"Generation delayed";

  return <div className="space-y-5">
    <section className="rounded-3xl border border-stone-800 bg-[#141a17] p-6">
      <Link href="/operations" className="inline-flex items-center gap-2 text-sm text-stone-400 hover:text-amber-300"><ArrowLeft size={16}/>Back to Pipeline Ops</Link>
      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">Operations</p><h1 className="mt-2 text-3xl font-bold">Recommendation pipeline</h1><p className="mt-2 text-sm text-stone-400">Batch health, market provenance, persisted opportunities, and trade linkage.</p><Link href="/operations/recommendations/history" className="mt-4 inline-flex items-center rounded-xl border border-amber-700/60 bg-amber-950/20 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-950/50">View batch history</Link></div>
        <span className={`inline-flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-sm font-semibold ${healthy?"border-emerald-700/50 bg-emerald-950/50 text-emerald-300":"border-amber-700/50 bg-amber-950/50 text-amber-300"}`}>{healthy?<CheckCircle2 size={16}/>:<TriangleAlert size={16}/>} {state}</span>
      </div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card icon={<Layers3 size={16}/>} label="Recommendation batches" value={number(summary.batches).toLocaleString()}/>
      <Card icon={<Database size={16}/>} label="Recommendations generated" value={number(summary.generated).toLocaleString()}/>
      <Card icon={<CheckCircle2 size={16}/>} label="Active and unexpired" value={number(summary.unexpired).toLocaleString()}/>
      <Card icon={<Clock3 size={16}/>} label="Linked trades" value={number(summary.linked_trades).toLocaleString()}/>
    </section>

    <section className="rounded-2xl border border-stone-800 bg-[#141a17] p-5">
      <h2 className="text-lg font-semibold">Latest batch</h2>
      {!latest?<p className="mt-4 text-sm text-stone-500">No recommendation batch has been generated.</p>:<div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Generated" value={date(latest.generated_at)}/><Stat label="Market observed" value={date(latest.market_observed_at)}/><Stat label="Source" value={String(latest.source)}/><Stat label="Candidates / persisted" value={`${number(latest.candidate_count)} / ${number(latest.recommendation_count)}`}/><Stat label="Batch age" value={`${Math.round(batchAge)} min`}/><Stat label="Market age at present" value={`${Math.round(marketAge)} min`}/><Stat label="Scoring version" value={String(latest.scoring_version)}/><Stat label="Model version" value={String(latest.model_version)}/>
      </div>}
      <p className="mt-4 text-xs text-stone-500">Empty batches: {number(summary.empty_batches)} · Active rows: {number(summary.active)}</p>
    </section>

    <section className="rounded-2xl border border-stone-800 bg-[#141a17] p-5"><h2 className="text-lg font-semibold">Generation sources</h2><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="border-b border-stone-800 text-xs uppercase tracking-wide text-stone-500"><tr><Th>Source</Th><Th>Batches</Th><Th>Recommendations</Th><Th>Last generated</Th></tr></thead><tbody>{sourceRows.map(row=><tr key={String(row.source)} className="border-b border-stone-800/70 last:border-0"><Td>{String(row.source)}</Td><Td>{number(row.batches).toLocaleString()}</Td><Td>{number(row.recommendations).toLocaleString()}</Td><Td>{date(row.last_generated_at)}</Td></tr>)}</tbody></table></div></section>
  </div>;
}
function Card({icon,label,value}:{icon:React.ReactNode;label:string;value:string}){return <article className="rounded-2xl border border-stone-800 bg-[#141a17] p-4"><p className="flex items-center gap-2 text-xs text-stone-500">{icon}{label}</p><p className="mt-2 text-xl font-semibold">{value}</p></article>}
function Stat({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-stone-950/50 p-3"><p className="text-xs text-stone-500">{label}</p><p className="mt-1 font-semibold">{value}</p></div>}
function Th({children}:{children:React.ReactNode}){return <th className="px-3 py-3 font-medium">{children}</th>}
function Td({children}:{children:React.ReactNode}){return <td className="px-3 py-3 text-stone-300">{children}</td>}
