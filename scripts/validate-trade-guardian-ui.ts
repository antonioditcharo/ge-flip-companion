import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main() {
  const page = await readFile("src/app/trades/page.tsx", "utf8");
  for (const required of [
    "refreshTradeGuardian",
    "recordTradeOffer",
    "GuardianPanel",
    "guidance_status",
    "recommended_price",
    "break_even_price",
    "quote_age_minutes",
    "reason_codes",
    "guardian_alert_id",
    "Refresh market and guidance",
  ]) {
    assert.ok(page.includes(required), `Missing expected Guardian UI marker: ${required}`);
  }
  assert.ok(page.includes('action={recordTradeOffer}'));
  assert.ok(page.includes('action={refreshTradeGuardian}'));
  assert.ok(page.includes('timeZone: "America/Anchorage"'));
  assert.ok(page.includes("never changes an in-game order"));
  console.log("Active Trade Guardian UI validation passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
