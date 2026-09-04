import { sql } from "@/lib/db";

export type RecommendationBatchSource =
  | "SCHEDULED_MARKET_SYNC"
  | "IN_APP_MARKET_SYNC"
  | "MANUAL"
  | "RECOVERY";

export type RecommendationBatchResult = {
  batchId: string;
  candidateCount: number;
  recommendationCount: number;
};

export async function generateRecommendationBatch(
  source: RecommendationBatchSource,
  metadata: Record<string, unknown> = {},
): Promise<RecommendationBatchResult> {
  const rows = await sql`
    select *
    from generate_recommendation_batch(
      ${source},
      ${JSON.stringify(metadata)}::jsonb
    )
  `;

  const row = rows[0];

  if (!row?.batch_id) {
    throw new Error("Recommendation generation did not return a batch ID.");
  }

  return {
    batchId: String(row.batch_id),
    candidateCount: Number(row.candidate_count ?? 0),
    recommendationCount: Number(row.recommendation_count ?? 0),
  };
}
