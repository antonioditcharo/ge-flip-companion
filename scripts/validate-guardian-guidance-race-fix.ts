import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main() {
  const source = await readFile(
    "src/lib/trade-guardian/persist.ts",
    "utf8",
  );

  for (const marker of [
    "returning id",
    "retirement_barrier as (",
    "select count(*) as retired_count from retired",
    "from retirement_barrier",
  ]) {
    assert.ok(
      source.includes(marker),
      `Missing guidance serialization marker: ${marker}`,
    );
  }

  const retiredAt = source.indexOf("with retired as (");
  const barrierAt = source.indexOf("retirement_barrier as (");
  const insertedAt = source.indexOf("inserted as (");
  const dependencyAt = source.indexOf("from retirement_barrier");

  assert.ok(retiredAt >= 0);
  assert.ok(retiredAt < barrierAt);
  assert.ok(barrierAt < insertedAt);
  assert.ok(insertedAt < dependencyAt);
  assert.ok(
    !source.includes(") values(\n        ${tradeId}::uuid"),
    "The independent VALUES insert still remains.",
  );

  console.log("Guardian guidance race-fix validation passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
