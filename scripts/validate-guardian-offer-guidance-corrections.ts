import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main() {
  const [engine, page, test] = await Promise.all([
    readFile("src/lib/trade-guardian/evaluate.ts", "utf8"),
    readFile("src/app/trades/page.tsx", "utf8"),
    readFile("scripts/validate-trade-guardian-engine.ts", "utf8"),
  ]);

  assert.ok(!engine.includes("const liquidityQuantity"));
  assert.ok(!engine.includes('"LOW_RECENT_VOLUME"'));
  assert.ok(engine.includes('reasonCodes: ["BUY_LIMIT_REMAINING"]'));
  assert.ok(engine.includes('input.side === "BUY" && input.buyLimitRemaining != null'));

  assert.ok(page.includes("row.buy_offer_price ?? row.suggested_buy_price"));
  assert.ok(page.includes("row.buy_offer_quantity ?? Math.max(0, planned - bought)"));
  assert.ok(page.includes("row.sell_offer_price ?? row.suggested_sell_price"));
  assert.ok(page.includes("row.sell_offer_quantity ?? Math.max(0, bought - sold)"));
  assert.ok(page.includes("price, quantity"));
  assert.ok(page.includes("Math.min(Math.max(1, quantity), Math.max(1, max))"));

  assert.ok(test.includes("lowVolumeDoesNotForceReduction"));
  assert.ok(test.includes("reduceForBuyLimit"));

  console.log("Guardian offer and quantity-guidance corrections validated.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
