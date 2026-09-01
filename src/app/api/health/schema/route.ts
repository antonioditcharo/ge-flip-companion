import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const requiredTables = [
  "app_settings",
  "items",
  "market_snapshots",
  "recommendations",
  "trades",
  "trade_events",
  "alerts",
];

export async function GET() {
  try {
    const rows = await sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `;

    const existingTables = rows.map((row) =>
      String(row.table_name),
    );

    const missingTables = requiredTables.filter(
      (table) => !existingTables.includes(table),
    );

    return NextResponse.json({
      status:
        missingTables.length === 0
          ? "healthy"
          : "incomplete",
      requiredTables,
      existingTables,
      missingTables,
    });
  } catch (error) {
    console.error("Schema health check failed:", error);

    return NextResponse.json(
      {
        status: "unhealthy",
        message:
          error instanceof Error
            ? error.message
            : "Unknown schema error",
      },
      {
        status: 500,
      },
    );
  }
}
