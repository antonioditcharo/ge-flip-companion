"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sql } from "@/lib/db";
const schema=z.object({recommendationId:z.string().uuid()});
export async function startTradeFromFinder(formData:FormData){
 const parsed=schema.safeParse({recommendationId:formData.get("recommendationId")});
 if(!parsed.success)redirect("/trade-finder?error=invalid-recommendation");
 const rows=await sql`with settings as(select account_mode,cash_stack,maximum_capital_percent from app_settings where id=1),selected as(select r.*,i.name,i.members from recommendations r join items i on i.id=r.item_id where r.id=${parsed.data.recommendationId}::uuid and r.active=true and r.expires_at>now() and r.batch_id=(select id from recommendation_batches order by generated_at desc limit 1)),portfolio as(select coalesce(sum(capital_committed),0) committed from trades where status not in('COMPLETED','CANCELLED')),free_slot as(select n slot_number from generate_series(1,case when(select account_mode from settings)='F2P' then 3 else 8 end)n where not exists(select 1 from trades where slot_number=n and status not in('COMPLETED','CANCELLED')) order by n limit 1),valid as(select s.*,f.slot_number from selected s cross join settings cfg cross join portfolio p cross join free_slot f where(cfg.account_mode='P2P' or s.members=false)and cfg.cash_stack-p.committed>=s.capital_required and s.capital_required<=cfg.cash_stack*cfg.maximum_capital_percent/100 and not exists(select 1 from trades where recommendation_id=s.id and status not in('COMPLETED','CANCELLED'))),inserted as(insert into trades(item_id,recommendation_id,slot_number,status,planned_quantity,suggested_buy_price,suggested_sell_price,capital_committed,expected_profit,expected_roi,current_instruction)select item_id,id,slot_number,'BUY_READY',recommended_quantity,recommended_buy_price,recommended_sell_price,capital_required,expected_profit,expected_roi,'Place a buy offer for '||recommended_quantity||' '||name||' at '||recommended_buy_price||' GP each.' from valid returning id,recommendation_id)insert into trade_events(trade_id,event_type,new_status,note,system_generated)select id,'TRADE_STARTED','BUY_READY','Created from persisted recommendation '||recommendation_id||'.',true from inserted returning trade_id`;
 if(rows.length===0)redirect("/trade-finder?error=could-not-start");
 revalidatePath("/");revalidatePath("/trade-finder");revalidatePath("/trades");redirect("/trades?started=1");
}
