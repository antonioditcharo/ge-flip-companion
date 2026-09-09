import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();
import { neon } from "@neondatabase/serverless";

const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL is required");
const sql=neon(databaseUrl);
const base="https://prices.runescape.wiki/api/v1/osrs";
const userAgent=process.env.OSRS_USER_AGENT;
if(!userAgent) throw new Error("OSRS_USER_AGENT is required and must identify the application and contact");

const args=new Map(process.argv.slice(2).map(value=>{const [k,v="true"]=value.replace(/^--/,"").split("=");return [k,v]}));
const timestep=args.get("timestep")??"5m";
const limit=Math.max(1,Math.min(500,Number(args.get("limit")??100)));
const concurrency=Math.max(1,Math.min(5,Number(args.get("concurrency")??2)));
const delayMs=Math.max(150,Number(args.get("delay-ms")??350));
if(!["5m","1h","6h","24h"].includes(timestep)) throw new Error("Invalid timestep");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

const candidates=await sql`
  with tracked as(
    select
      b.item_id,
      max(b.bucket_at) last_bar_at,
      coalesce(sum(coalesce(b.high_price_volume,0)+coalesce(b.low_price_volume,0))
        filter(where b.bucket_at>=now()-interval '24 hours'),0) recent_volume
    from market_bars b
    where b.timestep=${timestep}
    group by b.item_id
  )
  select i.id,i.name,t.recent_volume volume
  from tracked t join items i on i.id=t.item_id
  where i.active=true
  order by t.recent_volume desc,t.last_bar_at desc,i.id
  limit ${limit}
`;

if(candidates.length===0){
  throw new Error(`No tracked ${timestep} market-history candidates were found.`);
}

const runRows=await sql`insert into market_ingestion_runs(timestep,requested_items,metadata)
 values(${timestep},${candidates.length},${JSON.stringify({limit,concurrency,delayMs,source:"MANUAL_RECOVERY",trigger:"backfill-market-history-script"})}::jsonb) returning id`;
const runId=runRows[0].id;
let completed=0,failed=0,received=0,upserted=0;

async function ingest(item){
  const url=new URL(base+"/timeseries");url.searchParams.set("id",String(item.id));url.searchParams.set("timestep",timestep);
  const response=await fetch(url,{headers:{"User-Agent":userAgent,Accept:"application/json"}});
  if(!response.ok) throw new Error(`${item.id} ${response.status}`);
  const body=await response.json();const rows=(body.data??[]).map(p=>({item_id:Number(item.id),bucket_at:new Date(Number(p.timestamp)*1000).toISOString(),avg_high_price:p.avgHighPrice??null,avg_low_price:p.avgLowPrice??null,high_price_volume:p.highPriceVolume??null,low_price_volume:p.lowPriceVolume??null}));
  received+=rows.length;
  if(rows.length){
    const result=await sql`insert into market_bars(item_id,timestep,bucket_at,avg_high_price,avg_low_price,high_price_volume,low_price_volume)
      select x.item_id,${timestep},x.bucket_at::timestamptz,x.avg_high_price,x.avg_low_price,x.high_price_volume,x.low_price_volume
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(item_id integer,bucket_at text,avg_high_price numeric,avg_low_price numeric,high_price_volume bigint,low_price_volume bigint)
      on conflict(item_id,timestep,bucket_at) do update set avg_high_price=excluded.avg_high_price,avg_low_price=excluded.avg_low_price,high_price_volume=excluded.high_price_volume,low_price_volume=excluded.low_price_volume,ingested_at=now() returning item_id`;
    upserted+=result.length;
  }
  completed++;
  console.log(`[${completed+failed}/${candidates.length}] ${item.name}: ${rows.length} bars`);
  await sleep(delayMs);
}

try{
 let cursor=0;
 async function worker(){while(cursor<candidates.length){const item=candidates[cursor++];try{await ingest(item)}catch(error){failed++;console.error(`Failed ${item.name}:`,error.message);await sleep(delayMs*2)}}}
 await Promise.all(Array.from({length:concurrency},worker));
 await sql`update market_ingestion_runs set status='COMPLETED',completed_at=now(),completed_items=${completed},failed_items=${failed},bars_received=${received},bars_upserted=${upserted} where id=${runId}`;
 console.log(JSON.stringify({runId:String(runId),timestep,requested:candidates.length,completed,failed,received,upserted},null,2));
}catch(error){await sql`update market_ingestion_runs set status='FAILED',completed_at=now(),completed_items=${completed},failed_items=${failed},bars_received=${received},bars_upserted=${upserted},error_summary=${String(error.message).slice(0,1000)} where id=${runId}`;throw error}
