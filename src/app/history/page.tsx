import Link from "next/link";
import { History } from "lucide-react";
import { sql } from "@/lib/db";
import { formatGp, formatStatus } from "@/lib/utils";

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ status?: string }>;

export default async function HistoryPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filter = params.status === "COMPLETED" || params.status === "CANCELLED" ? params.status : "ALL";
  const rows = await sql`
    select trades.*, items.name,
      coalesce((select count(*) from trade_events where trade_events.trade_id=trades.id),0) as event_count
    from trades join items on items.id=trades.item_id
    where trades.status in ('COMPLETED','CANCELLED')
      and (${filter} = 'ALL' or trades.status = ${filter})
    order by coalesce(trades.completed_at,trades.updated_at) desc
    limit 250
  `;

  return <div className="space-y-5">
    <section className="rounded-3xl border border-stone-800 bg-[#141a17] p-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300"><History size={24}/></div>
      <h1 className="mt-4 text-3xl font-bold">Trade History</h1>
      <p className="mt-2 text-sm text-stone-400">Review completed and cancelled flips, including actual execution results.</p>
    </section>
    <nav aria-label="History filters" className="flex flex-wrap gap-2">
      <Filter href="/history" active={filter === "ALL"}>All</Filter>
      <Filter href="/history?status=COMPLETED" active={filter === "COMPLETED"}>Completed</Filter>
      <Filter href="/history?status=CANCELLED" active={filter === "CANCELLED"}>Cancelled</Filter>
    </nav>
    {rows.length === 0 ? <section className="rounded-2xl border border-dashed border-stone-700 p-8 text-center text-stone-400">No trades match this filter yet.</section> :
    <section className="overflow-hidden rounded-2xl border border-stone-800 bg-[#141a17]">
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm">
        <thead className="border-b border-stone-800 bg-stone-950/40 text-xs uppercase text-stone-500"><tr><Th>Item</Th><Th>Status</Th><Th>Quantity</Th><Th>Average buy</Th><Th>Average sell</Th><Th>Realized profit</Th><Th>ROI</Th><Th>Finished</Th></tr></thead>
        <tbody>{rows.map(row => <tr key={String(row.id)} className="border-b border-stone-800/70 last:border-0">
          <Td><p className="font-semibold text-amber-200">{String(row.name)}</p><p className="mt-1 text-xs text-stone-500">Slot {String(row.slot_number)} · {String(row.event_count)} events</p></Td>
          <Td><span className={String(row.status) === "COMPLETED" ? "rounded-full bg-emerald-400/10 px-2 py-1 text-xs text-emerald-300" : "rounded-full bg-stone-700/50 px-2 py-1 text-xs text-stone-300"}>{formatStatus(String(row.status))}</span></Td>
          <Td>{Number(row.quantity_sold).toLocaleString()} / {Number(row.planned_quantity).toLocaleString()}</Td>
          <Td>{row.average_buy_price ? formatGp(String(row.average_buy_price)) : "Not recorded"}</Td>
          <Td>{row.average_sell_price ? formatGp(String(row.average_sell_price)) : "Not recorded"}</Td>
          <Td><span className={Number(row.realized_profit ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}>{row.realized_profit === null ? "Pending" : formatGp(String(row.realized_profit))}</span></Td>
          <Td>{row.realized_roi === null ? "Pending" : `${(Number(row.realized_roi) * 100).toFixed(2)}%`}</Td>
          <Td>{new Date(String(row.completed_at ?? row.updated_at)).toLocaleString("en-US")}</Td>
        </tr>)}</tbody>
      </table></div>
    </section>}
  </div>;
}
function Filter({href,active,children}:{href:string;active:boolean;children:React.ReactNode}){return <Link href={href} className={active ? "rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-stone-950" : "rounded-xl border border-stone-700 px-4 py-2 text-sm text-stone-300 hover:bg-stone-800"}>{children}</Link>}
function Th({children}:{children:React.ReactNode}){return <th className="px-4 py-3 font-medium">{children}</th>}
function Td({children}:{children:React.ReactNode}){return <td className="px-4 py-4 text-stone-300">{children}</td>}
