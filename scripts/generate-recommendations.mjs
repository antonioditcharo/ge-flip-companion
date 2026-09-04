import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing.");
}

const sql = neon(process.env.DATABASE_URL);
const sourceArgument = process.argv.find((value) => value.startsWith("--source="));
const source = sourceArgument?.slice("--source=".length) || "MANUAL";

const rows = await sql`
  select *
  from generate_recommendation_batch(
    ${source},
    ${{ trigger: "generate-recommendations-script" }}::jsonb
  )
`;

console.table(rows);
