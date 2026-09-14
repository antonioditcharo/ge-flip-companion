import Link from "next/link";
import { ArrowLeft, BellRing, CheckCircle2, Clock3, ShieldAlert, TriangleAlert } from "lucide-react";
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

export default async function GuardianOperationsPage() {
  const [summaryRows, statusRows, duplicateRows, missingRows] = await Promise.all([
    sql`
      select
        count(*) filter(where status not in ('COMPLETED','CANCELLED'))::integer active_trades,
        count(*) filter(where status not in ('COMPLETED','CANCELLED') and (buy_offer_price is not null or sell_offer_price is not null))::integer recorded_offers,
        count(*) filter(where status not in ('COMPLETED','CANCELLED') and last_evaluated_at>=now()-interval '30 minutes')::integer recently_evaluated,
        count(*) filter(where status not in ('COMPLETED','CANCELLED') and needs_attention)::integer needs_attention,
        max(last_evaluated_at) latest_evaluation
      from trades
    `,
    sql`
      select
        (select count(*) from trade_guidance where active)::integer active_guidance,
        (select count(*) from trade_guidance where active and expires_at<=now())::integer expired_guidance,
        (select count(*) from alerts where guidance_id is not null and not is_resolved)::integer unresolved_alerts,
        (select count(*) from alerts where guidance_id is not null and not is_resolved and severity='CRITICAL')::integer critical_alerts,
        (select max(observed_at) from market_snapshots) latest_snapshot
    `,
    sql`
      select dedupe_key,count(*)::integer alerts
      from alerts
      where dedupe_key is not null and not is_resolved
      group by dedupe_key having count(*)>1
      order by alerts desc
    `,
    sql`
      select t.id,i.name,t.slot_number,t.status,t.last_evaluated_at,
        (t.buy_offer_price is not null or t.sell_offer_price is not null) recorded_offer
      from trades t join items i on i.id=t.item_id
      where t.status not in ('COMPLETED','CANCELLED')
        and not exists(select 1 from trade_guidance g where g.trade_id=t.id and g.active)
      order by t.slot_number
    `,
  ]);

  const summary=summaryRows[0]??{};
  const state=statusRows[0]??{};
  const healthy=duplicateRows.length===0 && number(state.expired_guidance)===0 && number(missingRows.length)===0;

  return <div className="space-y-5">
    <section className="rounded-3xl border border-stone-800 bg-[#141a17] p-6">
      <Link href="/operations" className="inline-flex items-center gap-2 text-sm text-stone-400 hover:text-amber-300"><ArrowLeft size={16}/>Back to Pipeline Ops</Link>
      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">Operations</p><h1 className="mt-2 text-3xl font-bold">Active Trade Guardian</h1><p className="mt-2 text-sm text-stone-400">Offer coverage, guidance freshness, attention state, and alert integrity.</p></div>
        <span className={`inline-flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-sm font-semibold ${healthy?"border-emerald-700/50 bg-emerald-950/50 text-emerald-300":"border-amber-700/50 bg-amber-950/50 text-amber-300"}`}>{healthy?<CheckCircle2 size={16}/>:<TriangleAlert size={16}/>} {healthy?"Healthy":"Review required"}</span>
      </div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card label="Active trades" value={number(summary.active_trades)} icon={<ShieldAlert size={16}/>}/>
      <Card label="Recorded offers" value={number(summary.recorded_offers)} icon={<CheckCircle2 size={16}/>}/>
      <Card label="Evaluated in 30 min" value={number(summary.recently_evaluated)} icon={<Clock3 size={16}/>}/>
      <Card label="Needs attention" value={number(summary.needs_attention)} icon={<TriangleAlert size={16}/>}/>
      <Card label="Active guidance" value={number(state.active_guidance)} icon={<ShieldAlert size={16}/>}/>
      <Card label="Expired guidance" value={number(state.expired_guidance)} icon={<Clock3 size={16}/>}/>
      <Card label="Guardian alerts" value={number(state.unresolved_alerts)} icon={<BellRing size={16}/>}/>
      <Card label="Critical alerts" value={number(state.critical_alerts)} icon={<TriangleAlert size={16}/>}/>
    </section>

    <section className="rounded-2xl border border-stone-800 bg-[#141a17] p-5"><h2 className="text-lg font-semibold">Freshness</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><Stat label="Latest market snapshot" value={date(state.latest_snapshot)}/><Stat label="Latest Guardian evaluation" value={date(summary.latest_evaluation)}/></div></section>

    <section className="rounded-2xl border border-stone-800 bg-[#141a17] p-5"><h2 className="text-lg font-semibold">Trades missing active guidance</h2>{missingRows.length===0?<p className="mt-3 text-sm text-emerald-300">Every active trade has active Guardian guidance.</p>:<div className="mt-3 space-y-2">{missingRows.map(row=><div key={String(row.id)} className="flex flex-wrap justify-between gap-2 rounded-xl bg-stone-950/50 p-3 text-sm"><span>{String(row.name)} · Slot {String(row.slot_number)} · {String(row.status)}</span><span className="text-stone-500">Offer recorded: {Boolean(row.recorded_offer)?"Yes":"No"}</span></div>)}</div>}</section>

    <section className="rounded-2xl border border-stone-800 bg-[#141a17] p-5"><h2 className="text-lg font-semibold">Alert deduplication</h2>{duplicateRows.length===0?<p className="mt-3 text-sm text-emerald-300">No duplicate unresolved Guardian alert keys.</p>:<div className="mt-3 space-y-2">{duplicateRows.map(row=><div key={String(row.dedupe_key)} className="rounded-xl bg-red-950/30 p-3 text-sm text-red-200">{String(row.dedupe_key)} · {String(row.alerts)} alerts</div>)}</div>}</section>
  </div>;
}

function Card({label,value,icon}:{label:string;value:number;icon:React.ReactNode}){return <article className="rounded-2xl border border-stone-800 bg-[#141a17] p-4"><p className="flex items-center gap-2 text-xs text-stone-500">{icon}{label}</p><p className="mt-2 text-2xl font-semibold">{value.toLocaleString()}</p></article>}
function Stat({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-stone-950/50 p-3"><p className="text-xs text-stone-500">{label}</p><p className="mt-1 font-semibold">{value}</p></div>}
