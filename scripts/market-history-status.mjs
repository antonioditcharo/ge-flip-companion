import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();import{neon}from"@neondatabase/serverless";const sql=neon(process.env.DATABASE_URL);console.table(await sql`select timestep,count(*) bars,count(distinct item_id) items,min(bucket_at) first_bar,max(bucket_at) last_bar from market_bars group by timestep order by timestep`);console.table(await sql`select id,status,timestep,requested_items,completed_items,failed_items,bars_upserted,started_at,completed_at from market_ingestion_runs order by id desc limit 10`);