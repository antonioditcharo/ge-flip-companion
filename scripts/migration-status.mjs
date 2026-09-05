import crypto from "node:crypto";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing.");
const sql = neon(process.env.DATABASE_URL);
const dir = path.resolve("db/migrations");
const files = (await fs.readdir(dir)).filter((x)=>/^\d{3}_[a-z0-9_]+\.sql$/.test(x)).sort();
const ledger = await sql`select migration_name,checksum_sha256,applied_at,execution_ms,baseline from schema_migrations order by migration_name`;
const byName = new Map(ledger.map((row)=>[String(row.migration_name),row]));
const rows=[];
for(const file of files){const data=await fs.readFile(path.join(dir,file));const digest=crypto.createHash("sha256").update(data).digest("hex");const entry=byName.get(file);rows.push({migration:file,status:!entry?"PENDING":String(entry.checksum_sha256)===digest?"APPLIED":"CHECKSUM_MISMATCH",baseline:entry?.baseline??null,applied_at:entry?.applied_at??null});}
console.table(rows);
if(rows.some((row)=>row.status!=="APPLIED"))process.exitCode=1;
