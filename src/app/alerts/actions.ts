"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sql } from "@/lib/db";
import { syncMarketSnapshots } from "@/lib/jobs/market-snapshots";
import { refreshActiveTradeGuidance } from "@/lib/trade-guardian/persist";

const schema = z.object({ id: z.string().uuid() });

function refreshPaths() {
  for (const path of ["/", "/alerts", "/trades"]) revalidatePath(path);
}

export async function refreshAlerts() {
  try {
    const snapshots = await syncMarketSnapshots();
    const guardian = await refreshActiveTradeGuidance();

    await sql`
      insert into alerts(
        trade_id,item_id,severity,alert_type,title,message,recommended_action
      )
      select
        trade.id,
        trade.item_id,
        case when now()-trade.updated_at>interval '12 hours' then 'CRITICAL' else 'WARNING' end,
        'STALE_TRADE',
        'Trade needs an update',
        item.name||' in slot '||trade.slot_number||' has not been updated recently.',
        'Check the Grand Exchange offer and record a fill, offer update, or cancellation.'
      from trades trade
      join items item on item.id=trade.item_id
      where trade.status not in ('COMPLETED','CANCELLED')
        and now()-trade.updated_at>interval '2 hours'
        and not exists(
          select 1 from alerts alert
          where alert.trade_id=trade.id
            and alert.alert_type='STALE_TRADE'
            and not alert.is_resolved
        )
    `;

    console.info("Alerts and Guardian refreshed", { snapshots, guardian });
    refreshPaths();
  } catch (error) {
    console.error("Alerts and Guardian refresh failed", error);
    redirect("/alerts?refreshError=1");
  }
  redirect("/alerts?refreshed=1");
}

export async function updateAlert(formData: FormData) {
  const parsed = schema.safeParse({ id: formData.get("alertId") });
  const mode = String(formData.get("mode") ?? "");
  if (!parsed.success || !["read", "resolve"].includes(mode)) {
    redirect("/alerts?error=invalid");
  }
  if (mode === "read") {
    await sql`update alerts set is_read=true where id=${parsed.data.id}::uuid`;
  } else {
    await sql`update alerts set is_read=true,is_resolved=true where id=${parsed.data.id}::uuid`;
  }
  refreshPaths();
  redirect("/alerts?updated=1");
}
