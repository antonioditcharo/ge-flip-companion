import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock3,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { sql } from "@/lib/db";
import { formatGp, formatStatus } from "@/lib/utils";
import { cancelTrade, recordTradeFill } from "./actions";
import { recordTradeOffer, refreshTradeGuardian } from "./guardian-actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  started?: string;
  updated?: string;
  offerUpdated?: string;
  guardianRefreshed?: string;
  guardianError?: string;
  error?: string;
}>;

type TradeRow = Record<string, unknown>;

type GuardianSide = "BUY" | "SELL";

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isBuySide(status: string) {
  return ["BUY_READY", "BUY_PLACED", "PARTIALLY_BOUGHT"].includes(status);
}

function percent(value: unknown) {
  const parsed = nullableNumber(value);
  return parsed === null ? "Not available" : `${(parsed * 100).toFixed(2)}%`;
}

function quoteAge(value: unknown) {
  const parsed = nullableNumber(value);
  return parsed === null ? "Unknown" : `${Math.round(parsed)} min`;
}

function date(value: unknown) {
  if (!value) return "Not evaluated";
  return new Date(String(value)).toLocaleString("en-US", {
    timeZone: "America/Anchorage",
  });
}

function reasonCodes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export default async function TradesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const rows = (await sql`
    select
      trades.*,
      items.name,
      guidance.id as guidance_id,
      guidance.side as guidance_side,
      guidance.guidance_status,
      guidance.recommended_price,
      guidance.recommended_quantity,
      guidance.remaining_quantity,
      guidance.break_even_price,
      guidance.live_expected_profit,
      guidance.live_expected_roi,
      guidance.quote_age_minutes,
      guidance.reason_codes,
      guidance.message as guidance_message,
      guidance.evaluated_at as guidance_evaluated_at,
      guidance.expires_at as guidance_expires_at,
      guardian_alert.id as guardian_alert_id,
      guardian_alert.severity as guardian_alert_severity
    from trades
    join items on items.id = trades.item_id
    left join lateral (
      select trade_guidance.*
      from trade_guidance
      where trade_guidance.trade_id = trades.id
        and trade_guidance.active = true
      order by trade_guidance.evaluated_at desc
      limit 1
    ) guidance on true
    left join lateral (
      select alerts.id, alerts.severity
      from alerts
      where alerts.guidance_id = guidance.id
        and alerts.is_resolved = false
      order by alerts.created_at desc
      limit 1
    ) guardian_alert on true
    where trades.status not in ('COMPLETED', 'CANCELLED')
    order by trades.slot_number
  `) as TradeRow[];

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-stone-800 bg-[#141a17] p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300">
              <Activity size={24} />
            </div>
            <h1 className="mt-4 text-3xl font-bold">Active Trades</h1>
            <p className="mt-2 max-w-3xl text-sm text-stone-400">
              Record current Grand Exchange offers and actual fills. Guardian guidance uses public market observations and never changes an in-game order.
            </p>
          </div>
          <form action={refreshTradeGuardian}>
            <button className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-3 text-sm font-semibold text-stone-950 hover:bg-amber-300">
              <RefreshCw size={16} aria-hidden="true" />
              Refresh market and guidance
            </button>
          </form>
        </div>
      </section>

      {params.started === "1" && <Notice>Trade started and assigned to the first available GE slot.</Notice>}
      {params.updated === "1" && <Notice>Execution recorded and trade totals recalculated.</Notice>}
      {params.offerUpdated === "1" && <Notice>Current offer recorded and Guardian guidance refreshed.</Notice>}
      {params.guardianRefreshed === "1" && <Notice>Market observations and active-trade guidance refreshed.</Notice>}
      {params.guardianError === "1" && (
        <p role="alert" className="rounded-2xl border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-200">
          Guardian refresh failed. Check the server log, database schema, and OSRS_USER_AGENT configuration.
        </p>
      )}
      {params.error && (
        <p role="alert" className="rounded-2xl border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-200">
          {errorMessage(params.error)}
        </p>
      )}

      {rows.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-stone-700 bg-stone-950/30 p-8 text-center text-stone-400">
          No active trades. Start one from Trade Finder.
        </section>
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {rows.map((row) => {
            const status = String(row.status);
            const planned = number(row.planned_quantity);
            const bought = number(row.quantity_bought);
            const sold = number(row.quantity_sold);
            const side: GuardianSide = isBuySide(status) ? "BUY" : "SELL";
            const remaining = side === "BUY" ? planned - bought : bought - sold;
            const offerPrice = side === "BUY"
              ? number(row.buy_offer_price || row.suggested_buy_price)
              : number(row.sell_offer_price || row.suggested_sell_price);
            const offerQuantity = side === "BUY"
              ? number(row.buy_offer_quantity || Math.max(1, remaining))
              : number(row.sell_offer_quantity || Math.max(1, remaining));

            return (
              <article key={String(row.id)} className="rounded-2xl border border-stone-800 bg-[#141a17] p-5">
                <div className="flex justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase text-stone-500">GE slot {String(row.slot_number)}</p>
                    <h2 className="mt-1 text-xl font-semibold text-amber-200">{String(row.name)}</h2>
                  </div>
                  <span className="h-fit rounded-full bg-amber-400/10 px-3 py-1 text-xs text-amber-300">
                    {formatStatus(status)}
                  </span>
                </div>

                <GuardianPanel row={row} side={side} />

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <Metric label="Planned quantity" value={planned.toLocaleString()} />
                  <Metric label="Bought / sold" value={`${bought.toLocaleString()} / ${sold.toLocaleString()}`} />
                  <Metric label="Average buy" value={row.average_buy_price ? formatGp(String(row.average_buy_price)) : "Not recorded"} />
                  <Metric label="Average sell" value={row.average_sell_price ? formatGp(String(row.average_sell_price)) : "Not recorded"} />
                  <Metric label="Expected profit" value={formatGp(String(row.expected_profit))} />
                  <Metric label="Realized profit" value={row.realized_profit === null ? "Pending" : formatGp(String(row.realized_profit))} />
                </div>

                <OfferForm
                  id={String(row.id)}
                  side={side}
                  remaining={Math.max(0, remaining)}
                  price={offerPrice}
                  quantity={offerQuantity}
                  recorded={side === "BUY" ? row.buy_offer_price != null : row.sell_offer_price != null}
                />

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <FillForm id={String(row.id)} side="BUY" title="Record buy fill" icon={<ArrowDownToLine size={15} />} max={planned - bought} price={String(row.buy_offer_price ?? row.suggested_buy_price)} quantity={number(row.buy_offer_quantity ?? Math.max(0, planned - bought))} />
                  <FillForm id={String(row.id)} side="SELL" title="Record sell fill" icon={<ArrowUpFromLine size={15} />} max={bought - sold} price={String(row.sell_offer_price ?? row.suggested_sell_price)} quantity={number(row.sell_offer_quantity ?? Math.max(0, bought - sold))} />
                </div>

                <form action={cancelTrade} className="mt-4 border-t border-stone-800 pt-4">
                  <input type="hidden" name="tradeId" value={String(row.id)} />
                  <button className="rounded-lg border border-red-900/60 px-3 py-2 text-xs text-red-300 hover:bg-red-950/40">
                    Cancel trade
                  </button>
                </form>
              </article>
            );
          })}
        </section>
      )}

      <section className="flex items-start gap-3 rounded-2xl border border-amber-800/40 bg-amber-950/20 p-4 text-sm text-amber-100">
        <AlertTriangle className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
        <p>
          Guardian guidance is decision support based on recorded offers and public market data. Confirm every price, quantity, fill, and cancellation manually in the Grand Exchange.
        </p>
      </section>
    </div>
  );
}

function GuardianPanel({ row, side }: { row: TradeRow; side: GuardianSide }) {
  if (!row.guidance_id) {
    return (
      <section className="mt-4 rounded-xl border border-dashed border-stone-700 bg-stone-950/40 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-stone-300">
          <ShieldCheck size={16} className="text-amber-300" />
          Guardian not evaluated
        </div>
        <p className="mt-2 text-xs text-stone-500">Record the current {side.toLowerCase()} offer, or refresh market and guidance.</p>
      </section>
    );
  }

  const actionable = ["RAISE_PRICE", "LOWER_PRICE", "REDUCE_QUANTITY", "CANCEL_OR_REASSESS", "EXIT_AT_BREAK_EVEN"].includes(String(row.guidance_status));
  const reasons = reasonCodes(row.reason_codes);

  return (
    <section className={`mt-4 rounded-xl border p-4 ${actionable ? "border-amber-800/60 bg-amber-950/20" : "border-emerald-900/50 bg-emerald-950/15"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {actionable ? <AlertTriangle size={16} className="text-amber-300" /> : <ShieldCheck size={16} className="text-emerald-300" />}
          <h3 className="text-sm font-semibold">Guardian: {formatStatus(String(row.guidance_status))}</h3>
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-stone-500">
          <Clock3 size={13} /> {quoteAge(row.quote_age_minutes)} quote age
        </span>
      </div>
      <p className="mt-3 text-sm text-stone-300">{String(row.guidance_message ?? row.current_instruction ?? "Review this trade.")}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <GuardianMetric label="Recommended price" value={row.recommended_price == null ? "No change" : formatGp(String(row.recommended_price))} />
        <GuardianMetric label="Recommended qty" value={number(row.recommended_quantity).toLocaleString()} />
        <GuardianMetric label="Break-even" value={row.break_even_price == null ? "Not applicable" : formatGp(String(row.break_even_price))} />
        <GuardianMetric label="Live profit / ROI" value={`${row.live_expected_profit == null ? "N/A" : formatGp(String(row.live_expected_profit))} / ${percent(row.live_expected_roi)}`} />
      </div>
      {reasons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {reasons.map((reason) => <span key={reason} className="rounded-full bg-stone-950/70 px-2 py-1 text-[11px] text-stone-400">{formatStatus(reason)}</span>)}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-stone-500">
        <span>Evaluated {date(row.guidance_evaluated_at)}</span>
        <span>Expires {date(row.guidance_expires_at)}</span>
      </div>
      {Boolean(row.guardian_alert_id) && <p className="mt-2 text-xs text-amber-300">Associated {String(row.guardian_alert_severity).toLowerCase()} alert is open on the Alerts page.</p>}
    </section>
  );
}

function OfferForm({ id, side, remaining, price, quantity, recorded }: { id: string; side: GuardianSide; remaining: number; price: number; quantity: number; recorded: boolean }) {
  const disabled = remaining <= 0;
  return (
    <form action={recordTradeOffer} className="mt-4 rounded-xl border border-amber-900/50 bg-amber-950/10 p-3">
      <input type="hidden" name="tradeId" value={id} />
      <input type="hidden" name="side" value={side} />
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{recorded ? `Update recorded ${side.toLowerCase()} offer` : `Record current ${side.toLowerCase()} offer`}</p>
        <span className="text-xs text-stone-500">Remaining {remaining.toLocaleString()}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-xs text-stone-500">Price in GP<input aria-label={`${side} offer price`} name="price" type="number" min="1" defaultValue={Math.max(1, price)} disabled={disabled} className="mt-1 w-full rounded-lg border border-stone-700 bg-stone-950 px-2 py-2 text-sm text-stone-100" /></label>
        <label className="text-xs text-stone-500">Offer quantity<input aria-label={`${side} offer quantity`} name="quantity" type="number" min="1" max={Math.max(1, remaining)} defaultValue={Math.min(Math.max(1, quantity), Math.max(1, remaining))} disabled={disabled} className="mt-1 w-full rounded-lg border border-stone-700 bg-stone-950 px-2 py-2 text-sm text-stone-100" /></label>
      </div>
      <button disabled={disabled} className="mt-3 w-full rounded-lg border border-amber-700/70 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-950/50 disabled:cursor-not-allowed disabled:opacity-40">
        {recorded ? "Save offer update" : "Record offer"}
      </button>
    </form>
  );
}

function errorMessage(error: string) {
  if (error === "not-found") return "The trade cannot be cancelled while purchased inventory remains unsold. Sell the remaining inventory first.";
  if (error === "invalid-offer") return "The offer price or quantity was invalid.";
  if (error === "offer-state") return "That offer cannot be recorded in the trade's current state.";
  return "The entry was rejected. Check the trade state, quantity, and remaining buy or sell amount.";
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p role="status" className="rounded-2xl border border-emerald-800/50 bg-emerald-950/30 p-4 text-sm text-emerald-200">{children}</p>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-stone-950/60 p-3"><p className="text-xs text-stone-500">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}

function GuardianMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-stone-950/50 p-2"><p className="text-stone-500">{label}</p><p className="mt-1 font-semibold text-stone-200">{value}</p></div>;
}

function FillForm({ id, side, title, icon, max, price, quantity }: { id: string; side: GuardianSide; title: string; icon: React.ReactNode; max: number; price: string; quantity: number }) {
  const disabled = max <= 0;
  return <form action={recordTradeFill} className="rounded-xl border border-stone-800 bg-stone-950/30 p-3"><input type="hidden" name="tradeId" value={id} /><input type="hidden" name="side" value={side} /><p className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</p><p className="mt-1 text-xs text-stone-500">Remaining: {Math.max(0, max).toLocaleString()}</p><div className="mt-3 grid grid-cols-2 gap-2"><input aria-label={`${side} quantity`} name="quantity" type="number" min="1" max={Math.max(1, max)} defaultValue={Math.min(Math.max(1, quantity), Math.max(1, max))} disabled={disabled} className="rounded-lg border border-stone-700 bg-stone-950 px-2 py-2 text-sm" /><input aria-label={`${side} unit price`} name="unitPrice" type="number" min="1" defaultValue={price} disabled={disabled} className="rounded-lg border border-stone-700 bg-stone-950 px-2 py-2 text-sm" /></div><button disabled={disabled} className="mt-2 w-full rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-stone-950 disabled:cursor-not-allowed disabled:opacity-40">Record fill</button></form>;
}
