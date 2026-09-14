import { sql } from "@/lib/db";
import { evaluateTradeGuidance, type GuardianResult, type GuardianSide } from "@/lib/trade-guardian/evaluate";

type ActiveTradeRow = Record<string, unknown>;

export type GuardianRefreshSummary = {
  evaluatedTrades: number;
  guidanceRows: number;
  actionableRows: number;
  staleRows: number;
  alertsUpserted: number;
};

function number(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sideForStatus(status: string): GuardianSide {
  return ["BUY_READY", "BUY_PLACED", "PARTIALLY_BOUGHT"].includes(status) ? "BUY" : "SELL";
}

export function guidanceAlertType(result: GuardianResult) {
  if (result.status === "STALE_DATA") return "QUOTE_STALE";
  if (result.status === "REDUCE_QUANTITY") return "QUANTITY_ADJUSTMENT";
  if (result.status === "CANCEL_OR_REASSESS") return "PROFIT_BELOW_MINIMUM";
  if (result.status === "EXIT_AT_BREAK_EVEN") return "BREAK_EVEN_WARNING";
  return result.side === "BUY" ? "BUY_PRICE_ADJUSTMENT" : "SELL_PRICE_ADJUSTMENT";
}

export function guidanceSeverity(result: GuardianResult) {
  if (["CANCEL_OR_REASSESS", "EXIT_AT_BREAK_EVEN"].includes(result.status)) return "CRITICAL";
  if (result.status === "STALE_DATA" || result.actionable) return "WARNING";
  return "INFO";
}

export function guidanceDedupeKey(tradeId: string, result: GuardianResult) {
  const priceBand = result.recommendedPrice === null ? "none" : String(Math.round(result.recommendedPrice / Math.max(1, result.recommendedPrice * 0.0025)));
  const quantityBand = Math.floor(result.recommendedQuantity / Math.max(1, Math.ceil(result.recommendedQuantity * 0.05)));
  return [tradeId, result.side, guidanceAlertType(result), result.status, priceBand, quantityBand].join(":");
}

function evaluateRow(row: ActiveTradeRow) {
  const status = String(row.status);
  const side = sideForStatus(status);
  const bought = number(row.quantity_bought);
  const sold = number(row.quantity_sold);
  const planned = number(row.planned_quantity);
  const remainingQuantity = side === "BUY" ? Math.max(0, planned - bought) : Math.max(0, bought - sold);
  const currentOfferPrice = side === "BUY"
    ? number(row.buy_offer_price, number(row.suggested_buy_price))
    : number(row.sell_offer_price, number(row.suggested_sell_price));
  const currentOfferQuantity = side === "BUY"
    ? number(row.buy_offer_quantity, Math.max(1, remainingQuantity))
    : number(row.sell_offer_quantity, Math.max(1, remainingQuantity));
  const itemLimit = nullableNumber(row.buy_limit);
  const recordedWindowQuantity = number(row.recorded_window_quantity);
  const manualAdjustment = number(row.manual_adjustment);
  const buyLimitRemaining = itemLimit === null ? null : Math.max(0, itemLimit - recordedWindowQuantity - manualAdjustment);
  return evaluateTradeGuidance({
    side,
    currentOfferPrice,
    currentOfferQuantity,
    remainingQuantity,
    latestHigh: nullableNumber(row.latest_high),
    latestLow: nullableNumber(row.latest_low),
    latestHighTime: row.latest_high_time ? String(row.latest_high_time) : null,
    latestLowTime: row.latest_low_time ? String(row.latest_low_time) : null,
    averageHigh5m: nullableNumber(row.average_high_5m),
    averageLow5m: nullableNumber(row.average_low_5m),
    volume5m: number(row.volume_5m),
    volume1h: number(row.volume_1h),
    averageBuyPrice: nullableNumber(row.average_buy_price),
    minimumProfit: number(row.minimum_profit),
    minimumRoi: number(row.minimum_roi),
    buyLimitRemaining,
  });
}

async function persistGuidance(tradeId: string, itemId: number, snapshotId: number | null, result: GuardianResult) {
  const rows = await sql`
    with retired as (
      update trade_guidance
      set active=false,resolved_at=coalesce(resolved_at,now())
      where trade_id=${tradeId}::uuid and side=${result.side} and active=true
      returning id
    ), retirement_barrier as (
      select count(*) as retired_count from retired
    ), inserted as (
      insert into trade_guidance(
        trade_id,market_snapshot_id,evaluated_at,expires_at,side,guidance_status,
        current_offer_price,recommended_price,current_offer_quantity,recommended_quantity,
        remaining_quantity,break_even_price,live_expected_profit,live_expected_roi,
        quote_age_minutes,reason_codes,message,active
      )
      select
        ${tradeId}::uuid,${snapshotId},now(),${result.expiresAt}::timestamptz,${result.side},${result.status},
        null,${result.recommendedPrice},null,${result.recommendedQuantity},${result.remainingQuantity},
        ${result.breakEvenPrice},${result.liveExpectedProfit},${result.liveExpectedRoi},
        ${result.quoteAgeMinutes},${JSON.stringify(result.reasonCodes)}::jsonb,${result.message},true
      from retirement_barrier
      returning id
    )
    update trades set last_market_snapshot_id=${snapshotId},last_evaluated_at=now(),
      needs_attention=${result.actionable || result.status === "STALE_DATA"},current_instruction=${result.message},updated_at=now()
    where id=${tradeId}::uuid
    returning (select id from inserted) guidance_id
  `;
  const guidanceId = String(rows[0]?.guidance_id ?? "");
  if (!guidanceId) throw new Error(`Guidance persistence failed for trade ${tradeId}.`);
  if (!result.actionable) {
    await sql`update alerts set is_read=true,is_resolved=true where trade_id=${tradeId}::uuid and not is_resolved and alert_type in ('BUY_PRICE_ADJUSTMENT','SELL_PRICE_ADJUSTMENT','QUANTITY_ADJUSTMENT','PROFIT_BELOW_MINIMUM','BREAK_EVEN_WARNING','QUOTE_STALE')`;
    return 0;
  }
  const dedupeKey = guidanceDedupeKey(tradeId, result);
  const alertType = guidanceAlertType(result);
  const severity = guidanceSeverity(result);
  const title = result.status === "STALE_DATA" ? "Live quote refresh required" : `${result.side} order needs review`;
  await sql`update alerts set is_resolved=true where trade_id=${tradeId}::uuid and not is_resolved and alert_type=${alertType} and dedupe_key is distinct from ${dedupeKey}`;
  const alertRows = await sql`
    insert into alerts(trade_id,item_id,guidance_id,severity,alert_type,title,message,recommended_action,dedupe_key,last_evaluated_at,expires_at)
    values(${tradeId}::uuid,${itemId},${guidanceId}::uuid,${severity},${alertType},${title},${result.message},${result.actionable ? "Review and manually update the in-game offer, then record the change in CoFlipper." : "Refresh live market data."},${dedupeKey},now(),${result.expiresAt}::timestamptz)
    on conflict(dedupe_key) where dedupe_key is not null and is_resolved=false
    do update set guidance_id=excluded.guidance_id,severity=excluded.severity,title=excluded.title,message=excluded.message,recommended_action=excluded.recommended_action,last_evaluated_at=now(),expires_at=excluded.expires_at,is_read=false
    returning id
  `;
  return alertRows.length;
}

export async function refreshActiveTradeGuidance(): Promise<GuardianRefreshSummary> {
  const trades = await sql`
    with latest as (
      select distinct on(item_id) * from market_snapshots order by item_id,observed_at desc
    ), active_window as (
      select distinct on(item_id) item_id,recorded_quantity,manual_adjustment
      from trade_buy_limit_windows where window_ends_at>now() order by item_id,window_started_at desc
    )
    select t.*,i.buy_limit,s.id snapshot_id,s.latest_high,s.latest_low,s.latest_high_time,s.latest_low_time,
      s.average_high_5m,s.average_low_5m,
      coalesce(s.high_volume_5m,0)+coalesce(s.low_volume_5m,0) volume_5m,
      coalesce(s.high_volume_1h,0)+coalesce(s.low_volume_1h,0) volume_1h,
      coalesce(w.recorded_quantity,0) recorded_window_quantity,coalesce(w.manual_adjustment,0) manual_adjustment,
      cfg.minimum_profit,cfg.minimum_roi
    from trades t join items i on i.id=t.item_id cross join app_settings cfg
    left join latest s on s.item_id=t.item_id left join active_window w on w.item_id=t.item_id
    where t.status not in('COMPLETED','CANCELLED') and cfg.id=1
    order by t.slot_number
  `;
  let guidanceRows=0,actionableRows=0,staleRows=0,alertsUpserted=0;
  for (const row of trades) {
    const remaining = sideForStatus(String(row.status)) === "BUY"
      ? Math.max(0, number(row.planned_quantity)-number(row.quantity_bought))
      : Math.max(0, number(row.quantity_bought)-number(row.quantity_sold));
    if (remaining === 0) continue;
    const result=evaluateRow(row);
    alertsUpserted += await persistGuidance(String(row.id),number(row.item_id),nullableNumber(row.snapshot_id),result);
    guidanceRows++;
    if(result.actionable) actionableRows++;
    if(result.status==="STALE_DATA") staleRows++;
  }
  return {evaluatedTrades:trades.length,guidanceRows,actionableRows,staleRows,alertsUpserted};
}
