"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { syncMarketSnapshots } from "@/lib/jobs/market-snapshots";
import { generateRecommendationBatch } from "@/lib/recommendations/generate";

export async function syncMarketData() {
  try {
    const snapshots = await syncMarketSnapshots();
    const recommendations = await generateRecommendationBatch(
      "IN_APP_MARKET_SYNC",
      { trigger: "trade-finder-refresh", observedAt: snapshots.observedAt },
    );
    console.info("In-app market pipeline completed", { snapshots, recommendations });
    revalidatePath("/");
    revalidatePath("/trade-finder");
    revalidatePath("/alerts");
    revalidatePath("/operations/recommendations");
    revalidatePath("/operations/recommendations/history");
  } catch (error) {
    console.error("In-app market sync failed", error);
    redirect("/trade-finder?syncError=1");
  }
  redirect("/trade-finder?synced=1");
}
