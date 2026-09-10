import assert from "node:assert/strict";
import { breakEvenSellPrice, evaluateTradeGuidance, geTaxPerItem } from "../src/lib/trade-guardian/evaluate";

const now = "2026-09-10T22:00:00Z";
const recent = "2026-09-10T21:57:00Z";
const stale = "2026-09-10T21:30:00Z";

assert.equal(geTaxPerItem(49), 0);
assert.equal(geTaxPerItem(50), 1);
assert.equal(geTaxPerItem(250_000_000), 5_000_000);
assert.equal(breakEvenSellPrice(1_000), 1_020);

const staleResult = evaluateTradeGuidance({
  side: "BUY", currentOfferPrice: 100, currentOfferQuantity: 1_000, remainingQuantity: 1_000,
  latestHigh: 110, latestLow: 100, latestHighTime: stale, latestLowTime: stale,
  volume5m: 10_000, minimumProfit: 1_000, minimumRoi: 0.01, evaluatedAt: now,
});
assert.equal(staleResult.status, "STALE_DATA");
assert.equal(staleResult.actionable, false);

const raiseBuy = evaluateTradeGuidance({
  side: "BUY", currentOfferPrice: 95, currentOfferQuantity: 1_000, remainingQuantity: 1_000,
  latestHigh: 115, latestLow: 105, latestHighTime: recent, latestLowTime: recent,
  averageHigh5m: 115, averageLow5m: 105, volume5m: 10_000,
  minimumProfit: 1_000, minimumRoi: 0.01, minimumProfitImpact: 1_000, evaluatedAt: now,
});
assert.equal(raiseBuy.status, "RAISE_PRICE");
assert.equal(raiseBuy.recommendedPrice, 105);
assert.equal(raiseBuy.recommendedQuantity, 1_000);

const reduce = evaluateTradeGuidance({
  side: "BUY", currentOfferPrice: 100, currentOfferQuantity: 5_000, remainingQuantity: 5_000,
  latestHigh: 120, latestLow: 100, latestHighTime: recent, latestLowTime: recent,
  volume5m: 1_000, buyLimitRemaining: 200, minimumProfit: 0, minimumRoi: 0, evaluatedAt: now,
});
assert.equal(reduce.status, "REDUCE_QUANTITY");
assert.equal(reduce.recommendedQuantity, 200);

const lowerSell = evaluateTradeGuidance({
  side: "SELL", currentOfferPrice: 1_200, currentOfferQuantity: 2_000, remainingQuantity: 2_000,
  latestHigh: 1_100, latestLow: 1_050, latestHighTime: recent, latestLowTime: recent,
  averageHigh5m: 1_100, volume5m: 20_000, averageBuyPrice: 1_000,
  minimumProfit: 1_000, minimumRoi: 0.01, minimumProfitImpact: 1_000, evaluatedAt: now,
});
assert.equal(lowerSell.status, "LOWER_PRICE");
assert.equal(lowerSell.recommendedPrice, 1_100);
assert.equal(lowerSell.breakEvenPrice, 1_020);
assert.equal(lowerSell.liveExpectedProfit, 156_000);

const breakEven = evaluateTradeGuidance({
  side: "SELL", currentOfferPrice: 1_100, currentOfferQuantity: 100, remainingQuantity: 100,
  latestHigh: 1_000, latestLow: 990, latestHighTime: recent, latestLowTime: recent,
  volume5m: 10_000, averageBuyPrice: 1_000, minimumProfit: 0, minimumRoi: 0, evaluatedAt: now,
});
assert.equal(breakEven.status, "EXIT_AT_BREAK_EVEN");
assert.equal(breakEven.recommendedPrice, 1_020);

console.log("Active Trade Guardian engine validation passed.");
console.table([staleResult, raiseBuy, reduce, lowerSell, breakEven].map((result) => ({
  side: result.side,
  status: result.status,
  actionable: result.actionable,
  price: result.recommendedPrice,
  quantity: result.recommendedQuantity,
  quoteAge: result.quoteAgeMinutes,
})));
