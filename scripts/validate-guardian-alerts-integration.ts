import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main() {
  const [page, actions] = await Promise.all([
    readFile("src/app/alerts/page.tsx", "utf8"),
    readFile("src/app/alerts/actions.ts", "utf8"),
  ]);
  for (const marker of [
    "trade_guidance",
    "guidance_side",
    "guidance_status",
    "recommended_price",
    "recommended_quantity",
    "break_even_price",
    "quote_age_minutes",
    "Open active trades",
    "Guardian",
    'timeZone: "America/Anchorage"',
  ]) assert.ok(page.includes(marker), `Missing Alerts UI marker: ${marker}`);

  for (const marker of [
    "syncMarketSnapshots",
    "refreshActiveTradeGuidance",
    "STALE_TRADE",
    'redirect("/alerts?refreshError=1")',
    'revalidatePath(path)',
  ]) assert.ok(actions.includes(marker), `Missing Alerts action marker: ${marker}`);

  assert.ok(!actions.includes("'PRICE_MOVEMENT'"), "Legacy price-movement generation should not duplicate Guardian alerts.");
  assert.ok(page.includes("Boolean(row.is_read)"));
  assert.ok(page.includes("Boolean(row.guidance_id)"));
  console.log("Guardian Alerts integration validation passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
