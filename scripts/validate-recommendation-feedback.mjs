import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing.");
}

const sql = neon(process.env.DATABASE_URL);

const objects = await sql`
  select
    to_regclass('public.recommendation_batches') is not null as batch_table,
    exists (
      select 1 from information_schema.columns
      where table_schema='public'
        and table_name='recommendations'
        and column_name='batch_id'
    ) as batch_column,
    exists (
      select 1 from pg_proc
      where proname='generate_recommendation_batch'
    ) as generator_function
`;

const batches = await sql`
  select id, generated_at, market_observed_at, source,
    scoring_version, model_version, candidate_count, recommendation_count
  from recommendation_batches
  order by generated_at desc
  limit 10
`;

const violations = await sql`
  select count(*)::integer as violations
  from recommendations r
  where r.batch_id is not null
    and (
      r.rank is null
      or r.rank <= 0
      or r.classification not in ('High confidence','Balanced','Speculative')
      or r.recommended_sell_price <= r.recommended_buy_price
      or r.recommended_quantity <= 0
      or r.quote_age_minutes < 0
      or r.price_deviation < 0
    )
`;

const duplicateRanks = await sql`
  select count(*)::integer as duplicate_rank_groups
  from (
    select batch_id, rank
    from recommendations
    where batch_id is not null
    group by batch_id, rank
    having count(*) > 1
  ) duplicates
`;

console.log("--- Recommendation objects ---");
console.table(objects);
console.log("--- Recent batches ---");
console.table(batches);
console.log("--- Integrity checks ---");
console.table([...violations, ...duplicateRanks]);

const state = objects[0];
if (!state?.batch_table || !state?.batch_column || !state?.generator_function) {
  throw new Error("Recommendation feedback schema is incomplete.");
}
if (Number(violations[0]?.violations) !== 0) {
  throw new Error("Invalid persisted recommendation rows were found.");
}
if (Number(duplicateRanks[0]?.duplicate_rank_groups) !== 0) {
  throw new Error("Duplicate recommendation ranks were found.");
}

console.log("Recommendation feedback validation passed.");
