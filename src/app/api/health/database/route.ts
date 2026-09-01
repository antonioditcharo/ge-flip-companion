import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await sql`
      select
        current_database() as database_name,
        now() as checked_at
    `;

    return NextResponse.json({
      status: "healthy",
      database: result[0]?.database_name,
      checkedAt: result[0]?.checked_at,
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    return NextResponse.json(
      {
        status: "unhealthy",
        message:
          error instanceof Error
            ? error.message
            : "Unknown database error",
      },
      {
        status: 500,
      },
    );
  }
}
