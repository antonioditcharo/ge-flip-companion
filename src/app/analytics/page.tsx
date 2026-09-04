import Link from "next/link";
import { ArrowRight, BarChart3, CircleDollarSign, Gauge, Target, Trophy } from "lucide-react";
import { sql } from "@/lib/db";
import { formatGp } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const summaryRows = await sql`
    select
      count(*) filter(where status='COMPLETED') as completed,
      count(*) filter(where status='CANCELLED') as cancelled,
      coalesce(sum(realized_profit) filter(where status='COMPLETED'),0) as total_profit,
      coalesce(avg(realized_profit) filter(where status='COMPLETED'),0) as average_profit,
      coalesce(avg(realized_roi) filter(where status='COMPLETED'),0) as average_roi,
      coalesce(sum(capital_committed) filter(where status='COMPLETED'),0) as completed_capital
    from trades where status in ('COMPLETED','CANCELLED')
  `;
  const itemRows = await sql`
    select items.name, count(*) as trade_count,
      coalesce(sum(trades.realized_profit),0) as profit,
      coalesce(avg(trades.realized_roi),0) as roi
    from trades join items on items.id=trades.item_id
    where trades.status='COMPLETED'
    group by items.id,items.name
    order by profit desc
    limit 10
  `;
  const dayRows = await sql`
    select date_trunc('day',completed_at)::date as day,
      count(*) as trades, coalesce(sum(realized_profit),0) as profit
    from trades where status='COMPLETED' and completed_at is not null
      and completed_at >= now()-interval '30 days'
    group by 1 order by 1 desc
  `;
  const s = summaryRows[0] ?? {};
  const completed=Number(s.completed ?? 0), cancelled=Number(s.cancelled ?? 0), total=completed+cancelled;
  const completionRate=total > 0 ? completed/total*100 : 0;
  const maxItemProfit=Math.max(1,...itemRows.map(row=>Math.abs(Number(row.profit))));
  const maxDayProfit=Math.max(1,...dayRows.map(row=>Math.abs(Number(row.profit))));

  return <div className="space-y-5">
    <section className="rounded-3xl border border-stone-800 bg-[#141a17] p-6"><div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300"><BarChart3 size={24}/></div><h1 className="mt-4 text-3xl font-bold">Analytics</h1><p className="mt-2 text-sm text-stone-400">Performance calculated from completed trades with recorded execution prices.</p></div><Link href="/analytics/recommendations" className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-700/60 bg-amber-950/20 px-4 py-2.5 text-sm font-semibold text-amber-200 hover:bg-amber-950/50">Recommendation outcomes<ArrowRight size={16} aria-hidden="true" /></Link></div></section>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card icon={<CircleDollarSign size={16}/>} label="Realized profit" value={formatGp(String(s.total_profit ?? 0))}/>
      <Card icon={<Trophy size={16}/>} label="Completed trades" value={completed.toLocaleString()}/>
      <Card icon={<Gauge size={16}/>} label="Average ROI" value={`${(Number(s.average_roi ?? 0)*100).toFixed(2)}%`}/>
      <Card icon={<Target size={16}/>} label="Completion rate" value={`${completionRate.toFixed(1)}%`}/>
    </section>
    <section className="grid gap-5 xl:grid-cols-2">
      <Panel title="Top items by realized profit" empty={itemRows.length===0}>{itemRows.map((row,index)=><div key={String(row.name)} className="space-y-2"><div className="flex justify-between gap-4 text-sm"><span className="text-stone-300">{index+1}. {String(row.name)} <span className="text-xs text-stone-500">({String(row.trade_count)} trades)</span></span><span className={Number(row.profit)>=0?"text-emerald-300":"text-red-300"}>{formatGp(String(row.profit))}</span></div><Bar value={Number(row.profit)} max={maxItemProfit}/></div>)}</Panel>
      <Panel title="Last 30 days" empty={dayRows.length===0}>{dayRows.map(row=><div key={String(row.day)} className="space-y-2"><div className="flex justify-between text-sm"><span className="text-stone-400">{new Date(String(row.day)+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})} · {String(row.trades)} trades</span><span className={Number(row.profit)>=0?"text-emerald-300":"text-red-300"}>{formatGp(String(row.profit))}</span></div><Bar value={Number(row.profit)} max={maxDayProfit}/></div>)}</Panel>
    </section>
    <section className="rounded-2xl border border-stone-800 bg-[#141a17] p-5"><h2 className="text-lg font-semibold">Portfolio totals</h2><div className="mt-4 grid gap-3 sm:grid-cols-3"><Stat label="Average profit per completion" value={formatGp(String(s.average_profit ?? 0))}/><Stat label="Completed capital" value={formatGp(String(s.completed_capital ?? 0))}/><Stat label="Cancelled trades" value={cancelled.toLocaleString()}/></div></section>
  </div>;
}
function Card({icon,label,value}:{icon:React.ReactNode;label:string;value:string}){return <article className="rounded-2xl border border-stone-800 bg-[#141a17] p-4"><p className="flex items-center gap-2 text-xs text-stone-500">{icon}{label}</p><p className="mt-2 text-xl font-semibold">{value}</p></article>}
function Panel({title,empty,children}:{title:string;empty:boolean;children:React.ReactNode}){return <section className="rounded-2xl border border-stone-800 bg-[#141a17] p-5"><h2 className="text-lg font-semibold">{title}</h2><div className="mt-4 space-y-4">{empty?<p className="text-sm text-stone-500">Complete trades to populate this report.</p>:children}</div></section>}
function Bar({value,max}:{value:number;max:number}){const width=Math.max(2,Math.min(100,Math.abs(value)/max*100));return <div className="h-2 overflow-hidden rounded-full bg-stone-800"><div className={value>=0?"h-full rounded-full bg-emerald-400":"h-full rounded-full bg-red-400"} style={{width:`${width}%`}}/></div>}
function Stat({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-stone-950/50 p-3"><p className="text-xs text-stone-500">{label}</p><p className="mt-1 font-semibold">{value}</p></div>}
