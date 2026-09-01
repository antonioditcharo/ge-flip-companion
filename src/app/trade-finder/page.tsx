import { Search, TrendingUp, Database, AlertTriangle } from "lucide-react";
import { sql } from "@/lib/db";
import { formatGp } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Opportunity = {
  id: number;
  name: string;
  members: boolean;
  buyLimit: number | null;
  buyPrice: string;
  sellPrice: string;
  quantity: number;
  profitPerItem: string;
  totalProfit: string;
  roi: number;
  volume: number;
};

export default async function TradeFinderPage() {
  const settingsRows = await sql`
    select account_mode, cash_stack, minimum_profit, minimum_roi, maximum_capital_percent
    from app_settings where id = 1 limit 1
  `;
  const settings = settingsRows[0];
  if (!settings) throw new Error("Application settings were not found.");

  const rows = await sql`
    with latest_snapshot as (
      select distinct on (item_id)
        item_id, observed_at, latest_high, latest_low,
        high_volume_5m, low_volume_5m
      from market_snapshots
      order by item_id, observed_at desc
    ), candidates as (
      select
        items.id,
        items.name,
        items.members,
        items.buy_limit,
        latest_snapshot.observed_at,
        latest_snapshot.latest_low as buy_price,
        latest_snapshot.latest_high as sell_price,
        coalesce(latest_snapshot.high_volume_5m, 0) +
          coalesce(latest_snapshot.low_volume_5m, 0) as volume_5m
      from latest_snapshot
      inner join items on items.id = latest_snapshot.item_id
      where latest_snapshot.latest_low > 0
        and latest_snapshot.latest_high > latest_snapshot.latest_low
        and (${String(settings.account_mode)} = 'P2P' or items.members = false)
    ), calculated as (
      select *,
        least(
          coalesce(buy_limit, 1),
          greatest(
            1,
            floor(
              (${String(settings.cash_stack)}::numeric *
               ${String(settings.maximum_capital_percent)}::numeric / 100) /
              buy_price
            )::integer
          )
        ) as quantity,
        greatest(0, sell_price - floor(sell_price * 0.02) - buy_price) as net_profit_each
      from candidates
    )
    select *,
      net_profit_each * quantity as total_profit,
      case when buy_price > 0
        then net_profit_each::numeric / buy_price
        else 0
      end as roi
    from calculated
    where net_profit_each * quantity >= ${String(settings.minimum_profit)}::numeric
      and (net_profit_each::numeric / buy_price) >= ${String(settings.minimum_roi)}::numeric
      and volume_5m > 0
    order by total_profit desc, volume_5m desc
    limit 30
  `;

  const opportunities: Opportunity[] = rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    members: Boolean(row.members),
    buyLimit: row.buy_limit === null ? null : Number(row.buy_limit),
    buyPrice: String(row.buy_price),
    sellPrice: String(row.sell_price),
    quantity: Number(row.quantity),
    profitPerItem: String(row.net_profit_each),
    totalProfit: String(row.total_profit),
    roi: Number(row.roi) * 100,
    volume: Number(row.volume_5m),
  }));

  const freshnessRows = await sql`select max(observed_at) as last_sync from market_snapshots`;
  const lastSync = freshnessRows[0]?.last_sync ? new Date(String(freshnessRows[0].last_sync)) : null;

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-stone-800 bg-[#141a17] p-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300">
          <Search size={24} aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-3xl font-bold">Trade Finder</h1>
        <p className="mt-2 max-w-3xl text-sm text-stone-400">
          Opportunities are filtered by your account mode, cash stack, minimum profit, ROI target, buy limit, and maximum capital allocation.
        </p>
        <div className="mt-4 flex items-center gap-2 text-xs text-stone-500">
          <Database size={14} aria-hidden="true" />
          {lastSync ? `Last market sync: ${lastSync.toLocaleString("en-US")}` : "No market data has been synchronized yet."}
        </div>
      </section>

      {!lastSync ? (
        <section className="rounded-2xl border border-amber-800/40 bg-amber-950/20 p-5 text-amber-100">
          Run the market synchronization script from the Codespaces terminal, then refresh this page.
        </section>
      ) : opportunities.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-stone-700 bg-stone-950/30 p-8 text-center text-stone-400">
          No current opportunities meet all your Settings thresholds. Try lowering minimum profit or minimum ROI.
        </section>
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {opportunities.map((item, index) => (
            <article key={item.id} className="rounded-2xl border border-stone-800 bg-[#141a17] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Rank {index + 1} · Item {item.id}</p>
                  <h2 className="mt-1 text-xl font-semibold text-amber-200">{item.name}</h2>
                </div>
                <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">
                  {item.roi.toFixed(2)}% ROI
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Metric label="Suggested buy" value={formatGp(item.buyPrice)} />
                <Metric label="Suggested sell" value={formatGp(item.sellPrice)} />
                <Metric label="Quantity" value={item.quantity.toLocaleString()} />
                <Metric label="5-minute volume" value={item.volume.toLocaleString()} />
                <Metric label="Profit per item" value={formatGp(item.profitPerItem)} />
                <Metric label="Estimated total" value={formatGp(item.totalProfit)} positive />
              </div>

              <div className="mt-4 flex items-center gap-2 text-xs text-stone-500">
                <TrendingUp size={14} aria-hidden="true" />
                Buy limit: {item.buyLimit?.toLocaleString() ?? "Unknown"} · {item.members ? "Members" : "Free-to-play"}
              </div>
            </article>
          ))}
        </section>
      )}

      <div className="flex items-start gap-3 rounded-2xl border border-amber-800/40 bg-amber-950/20 p-4 text-sm text-amber-100">
        <AlertTriangle className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
        <p>
          Estimates use the latest observed low price as the buy target, latest high price as the sell target, and an estimated 2% seller tax. Prices and liquidity can change before your offers fill. Confirm every trade manually.
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-xl bg-stone-950/60 p-3">
      <p className="text-xs text-stone-500">{label}</p>
      <p className={`mt-1 font-semibold ${positive ? "text-emerald-300" : "text-stone-200"}`}>{value}</p>
    </div>
  );
}
