"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sql } from "@/lib/db";

const fillSchema = z.object({
  tradeId: z.string().uuid(),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().int().positive(),
});

const cancelSchema = z.object({ tradeId: z.string().uuid() });

function refresh() {
  revalidatePath("/");
  revalidatePath("/trades");
  revalidatePath("/history");
  revalidatePath("/analytics");
}

export async function recordTradeFill(formData: FormData) {
  const parsed = fillSchema.safeParse({
    tradeId: formData.get("tradeId"),
    side: formData.get("side"),
    quantity: formData.get("quantity"),
    unitPrice: formData.get("unitPrice"),
  });
  if (!parsed.success) redirect("/trades?error=invalid-fill");

  const { tradeId, side, quantity, unitPrice } = parsed.data;
  const rows = side === "BUY"
    ? await sql`
        with locked as (
          select * from trades where id=${tradeId}::uuid for update
        ), valid as (
          select * from locked
          where (
              status in (
                'BUY_READY',
                'BUY_PLACED',
                'PARTIALLY_BOUGHT'
              )
              or (
                status = 'SELL_READY'
                and quantity_bought = quantity_sold
              )
            )
            and quantity_bought + ${quantity} <= planned_quantity
        ), updated as (
          update trades t set
            quantity_bought = v.quantity_bought + ${quantity},
            average_buy_price = ((coalesce(v.average_buy_price,0) * v.quantity_bought) + (${unitPrice}::numeric * ${quantity})) / (v.quantity_bought + ${quantity}),
            capital_committed = round(((coalesce(v.average_buy_price,0) * v.quantity_bought) + (${unitPrice}::numeric * ${quantity})))::bigint,
            status = case when v.quantity_bought + ${quantity} = v.planned_quantity then 'BOUGHT' else 'PARTIALLY_BOUGHT' end,
            buy_completed_at = case when v.quantity_bought + ${quantity} = v.planned_quantity then now() else t.buy_completed_at end,
            current_instruction = case when v.quantity_bought + ${quantity} = v.planned_quantity then 'Purchase complete. Place a sell offer or record sell fills.' else 'Purchase partially filled. Record another buy fill when available.' end,
            updated_at=now()
          from valid v where t.id=v.id returning t.id,t.status
        )
        insert into trade_events(trade_id,event_type,quantity,unit_price,previous_status,new_status,note,system_generated)
        select u.id,'BUY_FILL',${quantity},${unitPrice},v.status,u.status,'Recorded an actual buy execution.',false
        from updated u join valid v on v.id=u.id returning trade_id`
    : await sql`
        with locked as (
          select * from trades where id=${tradeId}::uuid for update
        ), valid as (
          select * from locked
          where status in (
              'BOUGHT',
              'SELL_READY',
              'SELL_PLACED',
              'PARTIALLY_SOLD'
            )
            and quantity_bought > 0
            and quantity_sold + ${quantity} <= quantity_bought
        ), updated as (
          update trades t set
            quantity_sold = v.quantity_sold + ${quantity},
            average_sell_price = ((coalesce(v.average_sell_price,0) * v.quantity_sold) + (${unitPrice}::numeric * ${quantity})) / (v.quantity_sold + ${quantity}),
            realized_tax = v.realized_tax + (
              least(
                5000000::numeric,
                floor(${unitPrice}::numeric * 0.02)
              ) * ${quantity}
            )::bigint,
            status = case when v.quantity_sold + ${quantity} = v.quantity_bought and v.quantity_bought = v.planned_quantity then 'COMPLETED' when v.quantity_sold + ${quantity} = v.quantity_bought then 'SELL_READY' else 'PARTIALLY_SOLD' end,
            sell_started_at=coalesce(v.sell_started_at,now()),
            completed_at=case when v.quantity_sold + ${quantity} = v.quantity_bought and v.quantity_bought = v.planned_quantity then now() else t.completed_at end,
            realized_profit = round(
              (
                (coalesce(v.average_sell_price,0) * v.quantity_sold)
                + (${unitPrice}::numeric * ${quantity})
                - v.realized_tax
                - (
                  least(
                    5000000::numeric,
                    floor(${unitPrice}::numeric * 0.02)
                  ) * ${quantity}
                )
                - (
                  coalesce(v.average_buy_price,0)
                  * (v.quantity_sold + ${quantity})
                )
              )
            )::bigint,
            realized_roi = case
              when coalesce(v.average_buy_price,0) > 0 then
                (
                  (
                    (coalesce(v.average_sell_price,0) * v.quantity_sold)
                    + (${unitPrice}::numeric * ${quantity})
                    - v.realized_tax
                    - (
                      least(
                        5000000::numeric,
                        floor(${unitPrice}::numeric * 0.02)
                      ) * ${quantity}
                    )
                    - (
                      v.average_buy_price
                      * (v.quantity_sold + ${quantity})
                    )
                  )
                  / (
                    v.average_buy_price
                    * (v.quantity_sold + ${quantity})
                  )
                )
              else null
            end,
            current_instruction = case when v.quantity_sold + ${quantity} = v.quantity_bought and v.quantity_bought = v.planned_quantity then 'Trade completed using recorded execution prices.' when v.quantity_sold + ${quantity} = v.quantity_bought then 'All purchased units sold. Buy the remaining planned quantity or cancel the remainder.' else 'Sale partially filled. Record another sell fill when available.' end,
            updated_at=now()
          from valid v where t.id=v.id returning t.id,t.status,t.realized_profit
        ), cash_update as (
          update app_settings settings set cash_stack=settings.cash_stack+updated.realized_profit,updated_at=now() from updated
          where settings.id=1 and updated.status='COMPLETED' and updated.realized_profit is not null returning settings.id
        )
        insert into trade_events(trade_id,event_type,quantity,unit_price,previous_status,new_status,note,system_generated)
        select u.id,'SELL_FILL',${quantity},${unitPrice},v.status,u.status,case when u.status='COMPLETED' then 'Final sell recorded; realized profit added to portfolio cash.' else 'Recorded an actual sell execution.' end,false
        from updated u join valid v on v.id=u.id returning trade_id`;

  if (rows.length === 0) redirect(`/trades?error=${side === "BUY" ? "buy-limit" : "sell-limit"}`);
  refresh();
  redirect("/trades?updated=1");
}

export async function cancelTrade(formData: FormData) {
  const parsed=cancelSchema.safeParse({tradeId:formData.get("tradeId")});
  if(!parsed.success) redirect("/trades?error=invalid-update");
  const rows=await sql`
    with previous as (
      select id,status
      from trades
      where id=${parsed.data.tradeId}::uuid
        and status not in ('COMPLETED','CANCELLED')
        and quantity_bought = quantity_sold
    ),
    updated as (update trades set status='CANCELLED',current_instruction='Trade cancelled.',updated_at=now() where id in(select id from previous) returning id,status)
    insert into trade_events(trade_id,event_type,previous_status,new_status,note,system_generated)
    select updated.id,'TRADE_CANCELLED',previous.status,updated.status,'Cancelled manually.',false from updated join previous using(id) returning trade_id`;
  if(rows.length===0) redirect("/trades?error=not-found");
  refresh();redirect("/trades?updated=1");
}
