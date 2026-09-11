"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sql } from "@/lib/db";
import { syncMarketSnapshots } from "@/lib/jobs/market-snapshots";
import { refreshActiveTradeGuidance } from "@/lib/trade-guardian/persist";

const offerSchema=z.object({tradeId:z.string().uuid(),side:z.enum(["BUY","SELL"]),price:z.coerce.number().int().positive(),quantity:z.coerce.number().int().positive()});

function refreshPaths(){for(const path of ["/","/trades","/alerts"])revalidatePath(path)}

export async function recordTradeOffer(formData:FormData){
 const parsed=offerSchema.safeParse({tradeId:formData.get("tradeId"),side:formData.get("side"),price:formData.get("price"),quantity:formData.get("quantity")});
 if(!parsed.success)redirect("/trades?error=invalid-offer");
 const {tradeId,side,price,quantity}=parsed.data;
 const rows=side==="BUY"?await sql`
  with previous as(select * from trades where id=${tradeId}::uuid and status in('BUY_READY','BUY_PLACED','PARTIALLY_BOUGHT') for update),
  updated as(update trades t set buy_offer_price=${price},buy_offer_quantity=${quantity},buy_offer_placed_at=coalesce(t.buy_offer_placed_at,now()),buy_offer_updated_at=now(),status=case when t.status='BUY_READY' then 'BUY_PLACED' else t.status end,updated_at=now() from previous p where t.id=p.id returning t.id,t.status),
  event as(insert into trade_events(trade_id,event_type,unit_price,quantity,previous_status,new_status,note,system_generated) select u.id,case when p.buy_offer_price is null then 'BUY_OFFER_PLACED' else 'BUY_OFFER_REPRICED' end,${price},${quantity},p.status,u.status,'User recorded the current in-game buy offer.',false from updated u join previous p on p.id=u.id returning trade_id)
  select trade_id from event`
 :await sql`
  with previous as(select * from trades where id=${tradeId}::uuid and status in('BOUGHT','SELL_READY','SELL_PLACED','PARTIALLY_SOLD') and quantity_bought>quantity_sold for update),
  updated as(update trades t set sell_offer_price=${price},sell_offer_quantity=${quantity},sell_offer_placed_at=coalesce(t.sell_offer_placed_at,now()),sell_offer_updated_at=now(),status=case when t.status in('BOUGHT','SELL_READY') then 'SELL_PLACED' else t.status end,sell_started_at=coalesce(t.sell_started_at,now()),updated_at=now() from previous p where t.id=p.id returning t.id,t.status),
  event as(insert into trade_events(trade_id,event_type,unit_price,quantity,previous_status,new_status,note,system_generated) select u.id,case when p.sell_offer_price is null then 'SELL_OFFER_PLACED' else 'SELL_OFFER_REPRICED' end,${price},${quantity},p.status,u.status,'User recorded the current in-game sell offer.',false from updated u join previous p on p.id=u.id returning trade_id)
  select trade_id from event`;
 if(rows.length===0)redirect("/trades?error=offer-state");
 await refreshActiveTradeGuidance();refreshPaths();redirect("/trades?offerUpdated=1");
}

export async function refreshTradeGuardian(){
 try{await syncMarketSnapshots();const summary=await refreshActiveTradeGuidance();console.info("Trade Guardian refreshed",summary)}catch(error){console.error("Trade Guardian refresh failed",error);redirect("/trades?guardianError=1")}
 refreshPaths();redirect("/trades?guardianRefreshed=1");
}
