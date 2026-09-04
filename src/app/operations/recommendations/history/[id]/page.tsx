import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BarChart3, CheckCircle2, CircleSlash2, Link2 } from "lucide-react";
import { z } from "zod";
import { sql } from "@/lib/db";
import { formatGp } from "@/lib/utils";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

type PageProps = {
  params: Promise<{ id: string }>;
};

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

export default async function RecommendationBatchDetailPage({ params }: PageProps) {
  const parsed = idSchema.safeParse((await params).id);
  if (!parsed.success) notFound();

  const [batchRows, recommendationRows] = await Promise.all([
    sql`
      select id,generated_at,market_observed_at,source,scoring_version,
        model_version,candidate_count,recommendation_count,settings_snapshot,metadata
      from recommendation_batches
      where id=${parsed.data}::uuid
      limit 1
    `,
    sql`
      select r.id,r.rank,i.name,r.classification,r.recommended_buy_price,
        r.recommended_sell_price,r.recommended_quantity,r.capital_required,
        r.expected_profit,r.expected_roi,r.opportunity_score,r.confidence_score,
        r.liquidity_score,r.risk_score,r.quote_age_minutes,r.price_deviation,
        r.volume_5m,r.volume_1h,r.reason_codes,r.active,r.expires_at,
        t.id as trade_id,t.status as trade_status,t.realized_profit,t.realized_roi
      from recommendations r
      join items i on i.id=r.item_id
      left join trades t on t.recommendation_id=r.id
      where r.batch_id=${parsed.data}::uuid
      order by r.rank
    `,
  ]);

  const batch = batchRows[0];
  if (!batch) notFound();

  return <div className="space-y-5">
    <section className="rounded-3xl border border-stone-800 bg-[#141a17] p-6">
      <Link href="/operations/recommendations/history" className="inline-flex items-center gap-2 text-sm text-stone-400 hover:text-amber-300"><ArrowLeft size={16}/>Back to batch history</Link>
      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">{String(batch.source)}</p><h1 className="mt-2 text-3xl font-bold">Recommendation batch detail</h1><p className="mt-2 font-mono text-xs text-stone-500">{String(batch.id)}</p></div>
        <span className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-sm font-semibold ${recommendationRows.length?"bg-emerald-950/50 text-emerald-300":"bg-amber-950/50 text-amber-300"}`}>{recommendationRows.length?<CheckCircle2 size={16}/>:<CircleSlash2 size={16}/>} {recommendationRows.length?`${recommendationRows.length} persisted`:"Empty batch"}</span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Generated" value={date(batch.generated_at)}/><Stat label="Market observed" value={date(batch.market_observed_at)}/><Stat label="Candidates / persisted" value={`${number(batch.candidate_count)} / ${number(batch.recommendation_count)}`}/><Stat label="Versions" value={`${String(batch.scoring_version)} · ${String(batch.model_version)}`}/></div>
    </section>

    {recommendationRows.length===0?<section className="rounded-2xl border border-dashed border-stone-700 bg-stone-950/30 p-8 text-center"><CircleSlash2 className="mx-auto text-amber-300"/><h2 className="mt-3 font-semibold">No recommendations qualified</h2><p className="mt-2 text-sm text-stone-500">The generation cycle completed, but no candidates passed freshness, profit, ROI, liquidity, and deviation gates.</p></section>:<section className="space-y-3">{recommendationRows.map(row=><article key={String(row.id)} className="rounded-2xl border border-stone-800 bg-[#141a17] p-5"><div className="flex flex-col gap-3 sm:flex-row sm:justify-between"><div><p className="text-xs text-stone-500">Rank {String(row.rank)}</p><h2 className="mt-1 text-xl font-semibold text-amber-200">{String(row.name)}</h2><p className="mt-1 text-xs text-stone-500">{String(row.classification)}</p></div><span className="self-start rounded-full bg-stone-950 px-3 py-1 text-xs text-stone-300">Score {number(row.opportunity_score).toFixed(1)}</span></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Buy / sell" value={`${formatGp(String(row.recommended_buy_price))} / ${formatGp(String(row.recommended_sell_price))}`}/><Stat label="Quantity" value={number(row.recommended_quantity).toLocaleString()}/><Stat label="Expected profit" value={formatGp(String(row.expected_profit))}/><Stat label="Expected ROI" value={`${(number(row.expected_roi)*100).toFixed(2)}%`}/><Stat label="Liquidity / confidence" value={`${number(row.liquidity_score).toFixed(1)} / ${number(row.confidence_score).toFixed(1)}`}/><Stat label="Risk / deviation" value={`${number(row.risk_score).toFixed(1)} / ${(number(row.price_deviation)*100).toFixed(1)}%`}/><Stat label="5m / 1h volume" value={`${number(row.volume_5m).toLocaleString()} / ${number(row.volume_1h).toLocaleString()}`}/><Stat label="Quote age" value={`${Math.round(number(row.quote_age_minutes))} min`}/></div>{row.trade_id?<div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-3 text-sm text-emerald-200"><Link2 size={15}/>Linked trade: {String(row.trade_status)}{row.realized_profit!==null?` · ${formatGp(String(row.realized_profit))}`:""}</div>:<div className="mt-4 flex items-center gap-2 text-xs text-stone-500"><BarChart3 size={14}/>No trade was started from this recommendation.</div>}</article>)}</section>}
  </div>;
}

function Stat({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-stone-950/50 p-3"><p className="text-xs text-stone-500">{label}</p><p className="mt-1 font-semibold">{value}</p></div>}
