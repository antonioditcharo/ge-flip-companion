import {
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  Clock3,
  Database,
  Gauge,
  Search,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";

import { sql } from "@/lib/db";
import { formatGp } from "@/lib/utils";
import { startTradeFromFinder } from "./actions";
import { syncMarketData } from "./market-actions";

export const dynamic = "force-dynamic";

type Opportunity = {
  recommendationId: string;
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
  volume5m: number;
  volume1h: number;
  liquidityScore: number;
  confidenceScore: number;
  riskScore: number;
  opportunityScore: number;
  quoteAgeMinutes: number;
  priceDeviationPercent: number;
  classification: string;
};

type SearchParams = Promise<{
  synced?: string;
  syncError?: string;
}>;

export default async function TradeFinderPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const settingsRows = await sql`
    select
      account_mode,
      cash_stack,
      minimum_profit,
      minimum_roi,
      maximum_capital_percent
    from app_settings
    where id = 1
    limit 1
  `;

  const settings = settingsRows[0];
  if (!settings) {
    throw new Error("Application settings were not found.");
  }

  const committedRows = await sql`select coalesce(sum(capital_committed),0) as committed from trades where status not in ('COMPLETED','CANCELLED')`;
  const portfolioCash=BigInt(String(settings.cash_stack));
  const committedCash=BigInt(String(committedRows[0]?.committed??0));
  const liquidCash=portfolioCash>committedCash?portfolioCash-committedCash:BigInt(0);
  const dynamicRows = await sql`
    with latest_snapshot as (
      select distinct on (item_id)
        item_id,
        observed_at,
        latest_high,
        latest_high_time,
        latest_low,
        latest_low_time,
        average_high_5m,
        average_low_5m,
        high_volume_5m,
        low_volume_5m,
        average_high_1h,
        average_low_1h,
        high_volume_1h,
        low_volume_1h
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
        latest_snapshot.latest_low_time,
        latest_snapshot.latest_high_time,
        latest_snapshot.average_low_5m,
        latest_snapshot.average_high_5m,
        latest_snapshot.average_low_1h,
        latest_snapshot.average_high_1h,
        coalesce(latest_snapshot.high_volume_5m, 0) +
          coalesce(latest_snapshot.low_volume_5m, 0) as volume_5m,
        coalesce(latest_snapshot.high_volume_1h, 0) +
          coalesce(latest_snapshot.low_volume_1h, 0) as volume_1h
      from latest_snapshot
      inner join items on items.id = latest_snapshot.item_id
      where latest_snapshot.latest_low > 0
        and latest_snapshot.latest_high > latest_snapshot.latest_low
        and latest_snapshot.latest_low_time >= now() - interval '24 hours'
        and latest_snapshot.latest_high_time >= now() - interval '24 hours'
        and (${String(settings.account_mode)} = 'P2P' or items.members = false)
    ), measured as (
      select
        *,
        least(
          5000000,
          floor(sell_price * 0.02)
        ) as tax_per_item,
        greatest(
          extract(epoch from (
            now() - least(latest_low_time, latest_high_time)
          )) / 60,
          0
        ) as quote_age_minutes,
        case
          when average_low_1h > 0 and average_high_1h > 0 then
            greatest(
              abs(buy_price - average_low_1h) / average_low_1h,
              abs(sell_price - average_high_1h) / average_high_1h
            )
          when average_low_5m > 0 and average_high_5m > 0 then
            greatest(
              abs(buy_price - average_low_5m) / average_low_5m,
              abs(sell_price - average_high_5m) / average_high_5m
            )
          else 1
        end as price_deviation
      from candidates
    ), sized as (
      select
        *,
        greatest(0, sell_price - tax_per_item - buy_price) as net_profit_each,
        least(
          coalesce(buy_limit, 1),
          greatest(
            1,
            floor(
              (${String(liquidCash)}::numeric *
               ${String(settings.maximum_capital_percent)}::numeric / 100) /
              buy_price
            )::integer
          ),
          greatest(
            1,
            least(
              coalesce(nullif(volume_5m, 0), 1),
              greatest(1, floor(coalesce(volume_1h, 0) / 12)::integer)
            )
          )
        ) as quantity
      from measured
    ), scored as (
      select
        *,
        net_profit_each * quantity as total_profit,
        case
          when buy_price > 0 then net_profit_each::numeric / buy_price
          else 0
        end as roi,
        least(
          100,
          greatest(
            0,
            18 * ln(greatest(volume_1h, 1)) +
            8 * ln(greatest(volume_5m, 1))
          )
        ) as liquidity_score,
        least(
          100,
          greatest(
            0,
            100 - quote_age_minutes / 6 - price_deviation * 220
          )
        ) as confidence_score,
        least(
          100,
          greatest(
            0,
            25 + price_deviation * 250 +
            case when volume_5m < 5 then 25 else 0 end +
            case when volume_1h < 25 then 20 else 0 end +
            case when buy_limit is null then 10 else 0 end
          )
        ) as risk_score
      from sized
      where net_profit_each > 0
    ), ranked as (
      select
        *,
        least(
          100,
          greatest(
            0,
            liquidity_score * 0.35 +
            least(100, roi * 1000) * 0.25 +
            least(100, ln(greatest(total_profit, 1)) * 5) * 0.20 +
            confidence_score * 0.20 -
            risk_score * 0.15
          )
        ) as opportunity_score
      from scored
      where total_profit >= ${String(settings.minimum_profit)}::numeric
        and roi >= ${String(settings.minimum_roi)}::numeric
        and volume_1h > 0
        and price_deviation <= 0.35
    )
    select
      *,
      case
        when liquidity_score >= 70 and confidence_score >= 65 and risk_score <= 45
          then 'High confidence'
        when liquidity_score >= 40 and confidence_score >= 40 and risk_score <= 70
          then 'Balanced'
        else 'Speculative'
      end as classification
    from ranked
    order by opportunity_score desc, total_profit desc
    limit 40
  `;

  const persistedRows = await sql`
    select r.id recommendation_id,i.id,i.name,i.members,i.buy_limit,
      r.recommended_buy_price buy_price,r.recommended_sell_price sell_price,
      r.recommended_quantity quantity,
      greatest(0,r.expected_profit/nullif(r.recommended_quantity,0)) net_profit_each,
      r.expected_profit total_profit,r.expected_roi roi,r.volume_5m,r.volume_1h,
      r.liquidity_score,r.confidence_score,r.risk_score,r.opportunity_score,
      r.quote_age_minutes,r.price_deviation,r.classification
    from recommendations r join items i on i.id=r.item_id
    where r.active=true and r.expires_at>now()
      and r.batch_id=(select id from recommendation_batches order by generated_at desc limit 1)
    order by r.rank
  `;
  const rows=persistedRows.length>0?persistedRows:dynamicRows;

  const opportunities: Opportunity[] = rows.map((row) => ({
    recommendationId: String(row.recommendation_id ?? ""),
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
    volume5m: Number(row.volume_5m),
    volume1h: Number(row.volume_1h),
    liquidityScore: Number(row.liquidity_score),
    confidenceScore: Number(row.confidence_score),
    riskScore: Number(row.risk_score),
    opportunityScore: Number(row.opportunity_score),
    quoteAgeMinutes: Number(row.quote_age_minutes),
    priceDeviationPercent: Number(row.price_deviation) * 100,
    classification: String(row.classification),
  }));

  const freshnessRows = await sql`
    select
      max(observed_at) as last_sync,
      coalesce(
        max(observed_at) < now() - interval '30 minutes',
        false
      ) as is_stale
    from market_snapshots
  `;
  const lastSync = freshnessRows[0]?.last_sync
    ? new Date(String(freshnessRows[0].last_sync))
    : null;
  const isMarketDataStale =
    freshnessRows[0]?.is_stale === true ||
    String(freshnessRows[0]?.is_stale) === "true";

  const reliable = opportunities.filter(
    (item) => item.classification !== "Speculative",
  );
  const speculative = opportunities.filter(
    (item) => item.classification === "Speculative",
  );

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-stone-800 bg-[#141a17] p-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300">
          <Search size={24} aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-3xl font-bold">Trade Finder v2</h1>
        <p className="mt-2 max-w-3xl text-sm text-stone-400">
          Ranked using tax-adjusted profit, quote freshness, one-hour and five-minute liquidity, price stability, buy limits, and your portfolio settings.
        </p>
        <div className="mt-4 flex items-center gap-2 text-xs text-stone-500">
          <Database size={14} aria-hidden="true" />
          {lastSync
            ? `Last market sync: ${lastSync.toLocaleString("en-US", {
                timeZone: "America/Anchorage",
                month: "numeric",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
                timeZoneName: "short",
              })}`
            : "No market data has been synchronized yet."}
        </div>

        <form action={syncMarketData} className="mt-4">
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-xl border border-amber-700/60 px-4 py-2.5 text-sm font-semibold text-amber-200 hover:bg-amber-950/50"
          >
            <RefreshCw size={16} aria-hidden="true" />
            Refresh market data
          </button>
        </form>
      </section>

      {params.synced === "1" && (
        <p
          role="status"
          className="rounded-2xl border border-emerald-800/50 bg-emerald-950/30 p-4 text-sm text-emerald-200"
        >
          Market data refreshed successfully. Rankings use the latest
          synchronized snapshot.
        </p>
      )}

      {params.syncError === "1" && (
        <p
          role="alert"
          className="rounded-2xl border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-200"
        >
          Market synchronization failed. Check the server log and
          OSRS_USER_AGENT configuration.
        </p>
      )}

      {lastSync && isMarketDataStale && (
          <p className="rounded-2xl border border-amber-800/40 bg-amber-950/20 p-4 text-sm text-amber-100">
            Market data is more than 30 minutes old. Refresh before starting a
            new trade.
          </p>
        )}

      {!lastSync ? (
        <section className="rounded-2xl border border-amber-800/40 bg-amber-950/20 p-5 text-amber-100">
          Run the market synchronization script, then refresh this page.
        </section>
      ) : reliable.length === 0 && speculative.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-stone-700 bg-stone-950/30 p-8 text-center text-stone-400">
          No current opportunities meet the quality and Settings thresholds.
        </section>
      ) : (
        <>
          {reliable.length > 0 && (
            <OpportunitySection
              title="Recommended opportunities"
              description="Higher-quality candidates with acceptable liquidity, freshness, and price consistency."
              items={reliable}
            />
          )}

          {speculative.length > 0 && (
            <OpportunitySection
              title="Speculative watchlist"
              description="Potentially attractive spreads with weaker execution evidence. Treat these as research candidates, not primary recommendations."
              items={speculative}
              speculative
            />
          )}
        </>
      )}

      <div className="flex items-start gap-3 rounded-2xl border border-amber-800/40 bg-amber-950/20 p-4 text-sm text-amber-100">
        <AlertTriangle className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
        <p>
          Scores are estimates based on public market observations. Prices can move and public volume cannot confirm that your own offer will fill. Confirm every purchase and sale manually.
        </p>
      </div>
    </div>
  );
}

function OpportunitySection({
  title,
  description,
  items,
  speculative = false,
}: {
  title: string;
  description: string;
  items: Opportunity[];
  speculative?: boolean;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-stone-500">{description}</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {items.map((item, index) => (
          <OpportunityCard
            key={item.id}
            item={item}
            rank={index + 1}
            speculative={speculative}
          />
        ))}
      </div>
    </section>
  );
}

function OpportunityCard({
  item,
  rank,
  speculative,
}: {
  item: Opportunity;
  rank: number;
  speculative: boolean;
}) {
  const badgeClass = speculative
    ? "bg-amber-400/10 text-amber-300"
    : "bg-emerald-400/10 text-emerald-300";

  return (
    <article className="rounded-2xl border border-stone-800 bg-[#141a17] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Rank {rank} | Item {item.id}
          </p>
          <h3 className="mt-1 text-xl font-semibold text-amber-200">
            {item.name}
          </h3>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${badgeClass}`}>
          {item.classification}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Metric label="Suggested buy" value={formatGp(item.buyPrice)} />
        <Metric label="Suggested sell" value={formatGp(item.sellPrice)} />
        <Metric label="Quantity" value={item.quantity.toLocaleString()} />
        <Metric label="Estimated total" value={formatGp(item.totalProfit)} positive />
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Score label="Opportunity" value={item.opportunityScore} icon={BadgeCheck} />
        <Score label="Liquidity" value={item.liquidityScore} icon={BarChart3} />
        <Score label="Confidence" value={item.confidenceScore} icon={Gauge} />
        <Score label="Risk" value={item.riskScore} icon={ShieldAlert} inverse />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-stone-500">
        <p>ROI: {item.roi.toFixed(2)}%</p>
        <p>Profit each: {formatGp(item.profitPerItem)}</p>
        <p>5m volume: {item.volume5m.toLocaleString()}</p>
        <p>1h volume: {item.volume1h.toLocaleString()}</p>
        <p>Quote age: {Math.round(item.quoteAgeMinutes)} min</p>
        <p>Deviation: {item.priceDeviationPercent.toFixed(1)}%</p>
      </div>

      <form action={startTradeFromFinder} className="mt-4">
        <input type="hidden" name="recommendationId" value={item.recommendationId} />
        <button type="submit" disabled={!item.recommendationId} className="inline-flex w-full items-center justify-center rounded-xl bg-amber-400 px-4 py-3 text-sm font-semibold text-stone-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40">{item.recommendationId ? "Start trade" : "Refresh to enable"}</button>
      </form>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-stone-800 pt-4 text-xs text-stone-500">
        <span className="inline-flex items-center gap-1.5">
          <TrendingUp size={14} aria-hidden="true" />
          Buy limit: {item.buyLimit?.toLocaleString() ?? "Unknown"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock3 size={14} aria-hidden="true" />
          {item.members ? "Members" : "Free-to-play"}
        </span>
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  positive = false,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-xl bg-stone-950/60 p-3">
      <p className="text-xs text-stone-500">{label}</p>
      <p className={`mt-1 font-semibold ${positive ? "text-emerald-300" : "text-stone-200"}`}>
        {value}
      </p>
    </div>
  );
}

function Score({
  label,
  value,
  icon: Icon,
  inverse = false,
}: {
  label: string;
  value: number;
  icon: typeof BadgeCheck;
  inverse?: boolean;
}) {
  const normalized = Math.max(0, Math.min(100, value));
  const favorable = inverse ? normalized <= 45 : normalized >= 65;
  const barClass = favorable ? "bg-emerald-400" : normalized >= 40 ? "bg-amber-400" : "bg-red-400";

  return (
    <div className="rounded-xl border border-stone-800 bg-stone-950/30 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="inline-flex items-center gap-1.5 text-stone-400">
          <Icon size={13} aria-hidden="true" />
          {label}
        </span>
        <span className="font-semibold text-stone-200">{Math.round(normalized)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-800">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${normalized}%` }} />
      </div>
    </div>
  );
}
