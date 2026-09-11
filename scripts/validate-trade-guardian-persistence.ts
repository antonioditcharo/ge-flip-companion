import assert from "node:assert/strict";
import dotenv from "dotenv";
import type { GuardianResult } from "../src/lib/trade-guardian/evaluate";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
  throw new Error(
    "DATABASE_URL or POSTGRES_URL is missing from .env.local or .env.",
  );
}

async function main() {
const {
  guidanceAlertType,
  guidanceDedupeKey,
  guidanceSeverity,
} = await import("../src/lib/trade-guardian/persist");

const base: GuardianResult = {
  side: "BUY",
  status: "RAISE_PRICE",
  actionable: true,
  recommendedPrice: 105,
  recommendedQuantity: 1_000,
  remainingQuantity: 1_000,
  breakEvenPrice: null,
  liveExpectedProfit: 8_000,
  liveExpectedRoi: 0.08,
  quoteAgeMinutes: 3,
  expiresAt: "2026-09-10T22:10:00Z",
  reasonCodes: ["BUY_BELOW_RECENT_LOW"],
  message: "Review",
};

assert.equal(guidanceAlertType(base), "BUY_PRICE_ADJUSTMENT");
assert.equal(guidanceSeverity(base), "WARNING");
assert.equal(
  guidanceDedupeKey("trade-1", base),
  guidanceDedupeKey("trade-1", { ...base }),
);
assert.notEqual(
  guidanceDedupeKey("trade-1", base),
  guidanceDedupeKey("trade-1", {
    ...base,
    status: "REDUCE_QUANTITY",
    recommendedQuantity: 200,
  }),
);
assert.equal(
  guidanceSeverity({
    ...base,
    status: "EXIT_AT_BREAK_EVEN",
    side: "SELL",
  }),
  "CRITICAL",
);
assert.equal(
  guidanceAlertType({
    ...base,
    status: "STALE_DATA",
    actionable: false,
  }),
  "QUOTE_STALE",
);

console.log("Guardian persistence helper validation passed.");

}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
