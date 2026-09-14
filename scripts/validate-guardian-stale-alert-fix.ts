import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main() {
  const source = await readFile(
    "src/lib/trade-guardian/persist.ts",
    "utf8",
  );

  assert.ok(source.includes("if (!result.actionable) {"));
  assert.ok(!source.includes('result.status !== "STALE_DATA"'));
  assert.ok(
    source.includes("is_read=true,is_resolved=true"),
    "Non-actionable guidance must close obsolete alerts.",
  );

  const nonActionableAt = source.indexOf("if (!result.actionable) {");
  const dedupeAt = source.indexOf("const dedupeKey", nonActionableAt);
  const returnAt = source.indexOf("return 0;", nonActionableAt);

  assert.ok(nonActionableAt >= 0);
  assert.ok(returnAt > nonActionableAt);
  assert.ok(dedupeAt > returnAt);

  console.log("Guardian stale-alert behavior validation passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
