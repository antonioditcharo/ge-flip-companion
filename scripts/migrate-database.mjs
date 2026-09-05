import crypto from "node:crypto";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

neonConfig.webSocketConstructor = ws;

const migrationsDir = path.resolve("db/migrations");
const migrationPattern = /^\d{3}_[a-z0-9_]+\.sql$/;

async function migrationFiles() {
  return (await fs.readdir(migrationsDir))
    .filter((name) => migrationPattern.test(name))
    .sort();
}

async function checksum(file) {
  const contents = await fs.readFile(path.join(migrationsDir, file));
  return crypto.createHash("sha256").update(contents).digest("hex");
}

async function ensureLedger(client) {
  await client.query(`
    create table if not exists schema_migrations (
      migration_name text primary key,
      checksum_sha256 text not null,
      applied_at timestamptz not null default now(),
      execution_ms integer not null default 0,
      baseline boolean not null default false
    )
  `);
}

async function verifyExistingSchema(client) {
  const result = await client.query(`
    select
      to_regclass('public.market_bars') is not null as market_bars,
      to_regclass('public.market_ingestion_runs') is not null as market_ingestion_runs,
      to_regclass('public.model_item_eligibility') is not null as model_item_eligibility,
      to_regclass('public.ml_dataset_exports') is not null as ml_dataset_exports,
      to_regclass('public.job_locks') is not null as job_locks,
      to_regclass('public.recommendation_batches') is not null as recommendation_batches,
      to_regclass('public.recommendation_outcomes') is not null as recommendation_outcomes,
      exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='trades' and column_name='realized_tax'
      ) as realized_tax,
      exists (
        select 1 from pg_proc where proname='generate_recommendation_batch'
      ) as recommendation_generator
  `);
  const missing = Object.entries(result.rows[0])
    .filter(([, present]) => !present)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`Cannot baseline incomplete schema. Missing: ${missing.join(", ")}`);
  }
}

export async function migrateDatabase({ baselineExisting = false } = {}) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await ensureLedger(client);
    const files = await migrationFiles();
    if (baselineExisting) await verifyExistingSchema(client);

    for (const file of files) {
      const digest = await checksum(file);
      const existing = await client.query(
        `select checksum_sha256, baseline from schema_migrations where migration_name=$1`,
        [file],
      );
      if (existing.rows.length) {
        if (existing.rows[0].checksum_sha256 !== digest) {
          throw new Error(`Checksum mismatch for already-recorded migration ${file}.`);
        }
        console.log(`SKIP ${file}${existing.rows[0].baseline ? " (baseline)" : ""}`);
        continue;
      }

      if (baselineExisting) {
        await client.query(
          `insert into schema_migrations(migration_name,checksum_sha256,baseline) values($1,$2,true)`,
          [file, digest],
        );
        console.log(`BASELINE ${file}`);
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      const started = Date.now();
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `insert into schema_migrations(migration_name,checksum_sha256,execution_ms,baseline) values($1,$2,$3,false)`,
          [file, digest, Date.now() - started],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      console.log(`APPLY ${file}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  await migrateDatabase({ baselineExisting: process.argv.includes("--baseline-existing") });
}
