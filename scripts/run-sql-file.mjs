import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import {
  Pool,
  neonConfig,
} from "@neondatabase/serverless";
import ws from "ws";

dotenv.config({
  path: ".env.local",
  quiet: true,
});

dotenv.config({
  quiet: true,
});

const file = process.argv[2];

if (!file) {
  throw new Error(
    "Usage: node scripts/run-sql-file.mjs <file.sql>"
  );
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL was not loaded from .env.local or .env"
  );
}

neonConfig.webSocketConstructor = ws;

const migrationSql = await readFile(file, "utf8");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const client = await pool.connect();

try {
  console.log(`Applying ${file}...`);

  await client.query("BEGIN");

  /*
   * node-postgres-compatible clients can execute a migration
   * containing multiple SQL commands as a simple query.
   */
  await client.query(migrationSql);

  await client.query("COMMIT");

  console.log(`Applied ${file}`);
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    console.error("Rollback failed:", rollbackError);
  }

  console.error(`Failed to apply ${file}`);
  throw error;
} finally {
  client.release();
  await pool.end();
}
