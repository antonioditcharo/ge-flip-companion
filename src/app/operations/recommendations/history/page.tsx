import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleSlash2, Clock3, Layers3 } from "lucide-react";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

function n(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function when(value: unknown) {
  if (!value) return "Not available";
  return new Date(String(value)).toLocaleString("en-US", {
    timeZone: "America/Anchorage",
  });
}

export default async function RecommendationBatchHistoryPage() {
  const rows = await sql`
    select
      b.id,
      b.generated_at,
      b.market_observed_at,
      b.source,
      b.scoring_version,
      b.model_version,
      b.candidate_count,
      b.recommendation_count,
      count(r.id)::integer as stored_rows,
      count(r.id) filter (where r.active)::integer as active_rows,
      count(r.id) filter (where r.expires_at > now())::integer as unexpired_rows,
      count(t.id)::integer as linked_trades,
      count(t.id) filter (where t.status = 'COMPLETED')::integer as completed_trades,
      coalesce(sum(t.realized_profit) filter (where t.status = 'COMPLETED'), 0)::bigint as realized_profit
    from recommendation_batches b
    left join recommendations r on r.batch_id = b.id
    left join trades t on t.recommendation_id = r.id
    group by b.id
    order by b.generated_at desc
    limit 100
  `;

  return <div className="space-y-5">
    <section className="rounded-3xl border border-stone-800 bg-[#141a17] p-6">
      <Link href="/operations/recommendations" className="inline-flex items-center gap-2 text-sm text-stone-400 hover:text-amber-300"><ArrowLeft size={16}/>Back to Recommendation pipeline</Link>
      <div className="mt-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300"><Layers3 size={24}/></div>
      <h1 className="mt-4 text-3xl font-bold">Recommendation batch history</h1>
      <p className="mt-2 text-sm text-stone-400">The latest 100 generation cycles, including empty batches, provenance, persistence, and linked outcomes.</p>
    </section>

    {rows.length === 0 ? <section className="rounded-2xl border border-dashed border-stone-700 bg-stone-950/30 p-8 text-center text-stone-400">No recommendation batches have been generated.</section> : <section className="space-y-3">{rows.map((row) => {
      const empty = n(row.recommendation_count) === 0;
      return <article key={String(row.id)} className="rounded-2xl border border-stone-800 bg-[#141a17] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><div className="flex items-center gap-2">{empty ? <CircleSlash2 size={17} className="text-amber-300"/> : <CheckCircle2 size={17} className="text-emerald-300"/>}<h2 className="font-semibold">{String(row.source)}</h2></div><p className="mt-1 font-mono text-xs text-stone-500">{String(row.id)}</p></div>
          <span className={`self-start rounded-full px-3 py-1 text-xs font-semibold ${empty ? "bg-amber-950/50 text-amber-300" : "bg-emerald-950/50 text-emerald-300"}`}>{empty ? "Empty batch" : `${n(row.recommendation_count)} recommendations`}</span>
        </div>
        <Link href={`/operations/recommendations/history/${String(row.id)}`} className="mt-4 inline-flex items-center rounded-lg border border-stone-700 px-3 py-2 text-xs font-semibold text-stone-300 hover:border-amber-700 hover:text-amber-200">View batch details</Link>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Generated" value={when(row.generated_at)}/><Stat label="Market observed" value={when(row.market_observed_at)}/><Stat label="Candidates / rows" value={`${n(row.candidate_count)} / ${n(row.stored_rows)}`}/><Stat label="Active / unexpired" value={`${n(row.active_rows)} / ${n(row.unexpired_rows)}`}/><Stat label="Linked / completed" value={`${n(row.linked_trades)} / ${n(row.completed_trades)}`}/><Stat label="Realized profit" value={`${n(row.realized_profit).toLocaleString()} GP`}/><Stat label="Scoring" value={String(row.scoring_version)}/><Stat label="Model" value={String(row.model_version)}/></div>
      </article>;
    })}</section>}
    <p className="flex items-center gap-2 text-xs text-stone-500"><Clock3 size={14}/>Times are displayed in Anchorage local time.</p>
  </div>;
}

function Stat({label,value}:{label:string;value:string}) {
  return <div className="rounded-xl bg-stone-950/50 p-3"><p className="text-xs text-stone-500">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}
