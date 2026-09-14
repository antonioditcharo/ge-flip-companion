import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main() {
  const [page, operationsPage, healthRoute] = await Promise.all([
    readFile("src/app/operations/guardian/page.tsx", "utf8"),
    readFile("src/app/operations/page.tsx", "utf8"),
    readFile("src/app/api/health/schema/route.ts", "utf8"),
  ]);

  for (const marker of [
    "Active Trade Guardian",
    "Trades missing active guidance",
    "Alert deduplication",
    "trade_guidance",
    "expired_guidance",
  ]) {
    assert.ok(
      page.includes(marker),
      `Missing Guardian Operations marker: ${marker}`,
    );
  }

  assert.ok(
    operationsPage.includes('href="/operations/guardian"'),
    "Guardian Operations navigation is missing.",
  );

  for (const requirement of [
    "trade_guidance",
    "trade_buy_limit_windows",
    "buy_offer_price",
    "sell_offer_price",
    "last_evaluated_at",
    "guidance_id",
    "dedupe_key",
  ]) {
    assert.ok(
      healthRoute.includes(requirement),
      `Missing health requirement: ${requirement}`,
    );
  }

  assert.ok(
    !healthRoute.includes(",,"),
    "Schema health SQL contains a duplicate comma.",
  );

  assert.ok(
    !/\('alerts', 'dedupe_key'\),\s*\)/.test(healthRoute),
    "Schema health SQL contains a trailing tuple comma.",
  );

  console.log("Guardian Operations validation passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
