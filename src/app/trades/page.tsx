import { Activity, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { sql } from "@/lib/db";
import { formatGp, formatStatus } from "@/lib/utils";
import { cancelTrade, recordTradeFill } from "./actions";

export const dynamic="force-dynamic";
type SearchParams=Promise<{started?:string;updated?:string;error?:string}>;

export default async function TradesPage({searchParams}:{searchParams:SearchParams}){
  const params=await searchParams;
  const rows=await sql`select trades.*,items.name from trades join items on items.id=trades.item_id where trades.status not in ('COMPLETED','CANCELLED') order by trades.slot_number`;
  return <div className="space-y-5">
    <section className="rounded-3xl border border-stone-800 bg-[#141a17] p-6"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300"><Activity size={24}/></div><h1 className="mt-4 text-3xl font-bold">Active Trades</h1><p className="mt-2 text-sm text-stone-400">Record actual Grand Exchange fills. Weighted prices and realized results update automatically.</p></section>
    {params.started==="1"&&<Notice>Trade started and assigned to the first available GE slot.</Notice>}
    {params.updated==="1"&&<Notice>Execution recorded and trade totals recalculated.</Notice>}
    {params.error&&<p role="alert" className="rounded-2xl border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-200">The entry was rejected. Check the quantity against the remaining buy or sell amount.</p>}
    {rows.length===0?<section className="rounded-2xl border border-dashed border-stone-700 bg-stone-950/30 p-8 text-center text-stone-400">No active trades. Start one from Trade Finder.</section>:<section className="grid gap-4 xl:grid-cols-2">{rows.map(row=>{
      const planned=Number(row.planned_quantity), bought=Number(row.quantity_bought), sold=Number(row.quantity_sold);
      return <article key={String(row.id)} className="rounded-2xl border border-stone-800 bg-[#141a17] p-5">
        <div className="flex justify-between gap-4"><div><p className="text-xs uppercase text-stone-500">GE slot {String(row.slot_number)}</p><h2 className="mt-1 text-xl font-semibold text-amber-200">{String(row.name)}</h2></div><span className="h-fit rounded-full bg-amber-400/10 px-3 py-1 text-xs text-amber-300">{formatStatus(String(row.status))}</span></div>
        <p className="mt-4 rounded-xl bg-stone-950/60 p-3 text-sm text-stone-300">{String(row.current_instruction??"Record the next execution.")}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm"><M l="Planned quantity" v={planned.toLocaleString()}/><M l="Bought / sold" v={`${bought.toLocaleString()} / ${sold.toLocaleString()}`}/><M l="Average buy" v={row.average_buy_price?formatGp(String(row.average_buy_price)):"Not recorded"}/><M l="Average sell" v={row.average_sell_price?formatGp(String(row.average_sell_price)):"Not recorded"}/><M l="Expected profit" v={formatGp(String(row.expected_profit))}/><M l="Realized profit" v={row.realized_profit===null?"Pending":formatGp(String(row.realized_profit))}/></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2"><FillForm id={String(row.id)} side="BUY" title="Record buy fill" icon={<ArrowDownToLine size={15}/>} max={planned-bought} price={String(row.suggested_buy_price)}/><FillForm id={String(row.id)} side="SELL" title="Record sell fill" icon={<ArrowUpFromLine size={15}/>} max={bought-sold} price={String(row.suggested_sell_price)}/></div>
        <form action={cancelTrade} className="mt-4 border-t border-stone-800 pt-4"><input type="hidden" name="tradeId" value={String(row.id)}/><button className="rounded-lg border border-red-900/60 px-3 py-2 text-xs text-red-300 hover:bg-red-950/40">Cancel trade</button></form>
      </article>})}</section>}
  </div>
}
function Notice({children}:{children:React.ReactNode}){return <p role="status" className="rounded-2xl border border-emerald-800/50 bg-emerald-950/30 p-4 text-sm text-emerald-200">{children}</p>}
function M({l,v}:{l:string;v:string}){return <div className="rounded-xl bg-stone-950/60 p-3"><p className="text-xs text-stone-500">{l}</p><p className="mt-1 font-semibold">{v}</p></div>}
function FillForm({id,side,title,icon,max,price}:{id:string;side:"BUY"|"SELL";title:string;icon:React.ReactNode;max:number;price:string}){const disabled=max<=0;return <form action={recordTradeFill} className="rounded-xl border border-stone-800 bg-stone-950/30 p-3"><input type="hidden" name="tradeId" value={id}/><input type="hidden" name="side" value={side}/><p className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</p><p className="mt-1 text-xs text-stone-500">Remaining: {Math.max(0,max).toLocaleString()}</p><div className="mt-3 grid grid-cols-2 gap-2"><input aria-label={`${side} quantity`} name="quantity" type="number" min="1" max={Math.max(1,max)} defaultValue={Math.max(0,max)} disabled={disabled} className="rounded-lg border border-stone-700 bg-stone-950 px-2 py-2 text-sm"/><input aria-label={`${side} unit price`} name="unitPrice" type="number" min="1" defaultValue={price} disabled={disabled} className="rounded-lg border border-stone-700 bg-stone-950 px-2 py-2 text-sm"/></div><button disabled={disabled} className="mt-2 w-full rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-stone-950 disabled:cursor-not-allowed disabled:opacity-40">Record fill</button></form>}
