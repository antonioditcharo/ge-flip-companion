import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const requiredTables = [
  "app_settings",
  "items",
  "market_snapshots",
  "recommendation_batches",
  "recommendations",
  "trades",
  "trade_events",
  "alerts",
  "market_bars",
  "market_ingestion_runs",
  "model_item_eligibility",
  "ml_dataset_exports",
  "job_locks",
];

const requiredViews = [
  "market_bar_quality",
  "ml_training_rows_5m",
  "recommendation_outcomes",
];

const requiredFunctions = [
  "generate_recommendation_batch",
];

const requiredColumns = [
  ["recommendations", "batch_id"],
  ["recommendations", "rank"],
  ["recommendations", "classification"],
  ["trades", "recommendation_id"],
  ["trades", "realized_tax"],
] as const;

export async function GET() {
  try {
    const [relations, functions, columns] = await Promise.all([
      sql`
        select table_name, table_type
        from information_schema.tables
        where table_schema = 'public'
        union all
        select table_name, 'VIEW' as table_type
        from information_schema.views
        where table_schema = 'public'
        order by table_name
      `,
      sql`
        select distinct routine_name
        from information_schema.routines
        where routine_schema = 'public'
        order by routine_name
      `,
      sql`
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and (table_name, column_name) in (
            ('recommendations', 'batch_id'),
            ('recommendations', 'rank'),
            ('recommendations', 'classification'),
            ('trades', 'recommendation_id'),
            ('trades', 'realized_tax')
          )
      `,
    ]);

    const tables = new Set(
      relations
        .filter((row) => String(row.table_type) !== "VIEW")
        .map((row) => String(row.table_name)),
    );
    const views = new Set(
      relations
        .filter((row) => String(row.table_type) === "VIEW")
        .map((row) => String(row.table_name)),
    );
    const routineNames = new Set(
      functions.map((row) => String(row.routine_name)),
    );
    const columnKeys = new Set(
      columns.map(
        (row) => `${String(row.table_name)}.${String(row.column_name)}`,
      ),
    );

    const missingTables = requiredTables.filter(
      (table) => !tables.has(table),
    );
    const missingViews = requiredViews.filter(
      (view) => !views.has(view),
    );
    const missingFunctions = requiredFunctions.filter(
      (routine) => !routineNames.has(routine),
    );
    const missingColumns = requiredColumns
      .map(([table, column]) => `${table}.${column}`)
      .filter((key) => !columnKeys.has(key));

    const missingCount =
      missingTables.length +
      missingViews.length +
      missingFunctions.length +
      missingColumns.length;

    return NextResponse.json({
      status: missingCount === 0 ? "healthy" : "incomplete",
      checkedAt: new Date().toISOString(),
      requirements: {
        tables: requiredTables,
        views: requiredViews,
        functions: requiredFunctions,
        columns: requiredColumns.map(
          ([table, column]) => `${table}.${column}`,
        ),
      },
      missing: {
        tables: missingTables,
        views: missingViews,
        functions: missingFunctions,
        columns: missingColumns,
      },
      counts: {
        required: {
          tables: requiredTables.length,
          views: requiredViews.length,
          functions: requiredFunctions.length,
          columns: requiredColumns.length,
        },
        discovered: {
          tables: tables.size,
          views: views.size,
          functions: routineNames.size,
        },
      },
    });
  } catch (error) {
    console.error("Schema health check failed:", error);

    return NextResponse.json(
      {
        status: "unhealthy",
        checkedAt: new Date().toISOString(),
        message:
          error instanceof Error
            ? error.message
            : "Unknown schema error",
      },
      { status: 500 },
    );
  }
}
