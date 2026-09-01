import { neon } from "@neondatabase/serverless";

function getDatabaseUrl(): string {
  const databaseUrl =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL;

  if (!databaseUrl) {
    throw new Error(
      "Database connection is missing. Configure DATABASE_URL or POSTGRES_URL.",
    );
  }

  return databaseUrl;
}

export const sql = neon(getDatabaseUrl());
