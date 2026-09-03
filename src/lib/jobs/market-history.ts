import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

type Candidate = { id: number; name: string };
type ApiPoint = { timestamp: number; avgHighPrice?: number | null; avgLowPrice?: number | null; highPriceVolume?: number | null; lowPriceVolume?: number | null };
type JobOptions = { limit?: number; concurrency?: number; delayMs?: number; owner?: string };

const BASE_URL = "https://prices.runescape.wiki/api/v1/osrs";
const JOB_NAME = "market-history-5m";
const LOCK_MINUTES = 4;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function acquireLock(token: string, owner: string) {
  const rows = await sql`
    insert into job_locks(job_name, lock_token, expires_at, owner)
    values(${JOB_NAME}, ${token}::uuid, now() + (${LOCK_MINUTES} * interval '1 minute'), ${owner})
    on conflict(job_name) do update set
      lock_token = excluded.lock_token,
      acquired_at = now(),
      expires_at = excluded.expires_at,
      owner = excluded.owner
    where job_locks.expires_at < now()
    returning job_name
  `;
  return rows.length === 1;
}
async function releaseLock(token: string) {
  await sql`delete from job_locks where job_name=${JOB_NAME} and lock_token=${token}::uuid`;
}

export async function runMarketHistoryJob(options: JobOptions = {}) {
  const startedAt = Date.now();
  const limit = Math.max(1, Math.min(200, options.limit ?? 100));
  const concurrency = Math.max(1, Math.min(5, options.concurrency ?? 4));
  const delayMs = Math.max(100, options.delayMs ?? 200);
  const owner = options.owner ?? "http";
  const userAgent = process.env.OSRS_USER_AGENT ?? "GE Flip Companion - AntonioDitcharo on GitHub";
  const token = randomUUID();
  const locked = await acquireLock(token, owner);
  if (!locked) return { ok: true, skipped: true, reason: "COLLECTOR_ALREADY_RUNNING" };

  let runId: string | null = null;
  let completed = 0, failed = 0, received = 0, upserted = 0;
  try {
    const candidates = await sql`
      with tracked as (
        select
          bars.item_id,
          max(bars.bucket_at) as last_bar_at,
          coalesce(
            sum(
              coalesce(bars.high_price_volume, 0) +
              coalesce(bars.low_price_volume, 0)
            ) filter (
              where bars.bucket_at >= now() - interval '24 hours'
            ),
            0
          ) as recent_volume
        from market_bars bars
        where bars.timestep = '5m'
        group by bars.item_id
      ),
      latest_snapshot as (
        select distinct on (snapshot.item_id)
          snapshot.item_id,
          coalesce(snapshot.high_volume_1h, 0) +
            coalesce(snapshot.low_volume_1h, 0) as recent_volume
        from market_snapshots snapshot
        order by snapshot.item_id, snapshot.observed_at desc
      ),
      ranked as (
        select
          item.id,
          item.name,
          0 as source_priority,
          tracked.recent_volume,
          tracked.last_bar_at
        from tracked
        inner join items item
          on item.id = tracked.item_id
        where item.active = true

        union all

        select
          item.id,
          item.name,
          1 as source_priority,
          latest_snapshot.recent_volume,
          null::timestamptz as last_bar_at
        from latest_snapshot
        inner join items item
          on item.id = latest_snapshot.item_id
        where item.active = true
          and latest_snapshot.recent_volume > 0
          and not exists (
            select 1
            from tracked
          )
      )
      select id, name
      from ranked
      order by
        source_priority,
        recent_volume desc,
        last_bar_at desc nulls last,
        id
      limit ${limit}
    ` as unknown as Candidate[];
    if (candidates.length === 0) {
      throw new Error(
        "No market-history candidates were found in market_bars or market_snapshots.",
      );
    }

    const inserted = await sql`insert into market_ingestion_runs(timestep,requested_items,metadata)
      values('5m',${candidates.length},${JSON.stringify({limit,concurrency,delayMs,owner})}::jsonb) returning id`;
    runId = String((inserted[0] as {id: unknown}).id);
    let cursor = 0;
    async function ingest(item: Candidate) {
      const url = new URL(`${BASE_URL}/timeseries`);
      url.searchParams.set("id", String(item.id));
      url.searchParams.set("timestep", "5m");
      const response = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`${item.id} returned HTTP ${response.status}`);
      const body = await response.json() as {data?: ApiPoint[]};
      const bars = (body.data ?? []).map((point) => ({
        item_id: item.id, bucket_at: new Date(point.timestamp*1000).toISOString(),
        avg_high_price: point.avgHighPrice ?? null, avg_low_price: point.avgLowPrice ?? null,
        high_price_volume: point.highPriceVolume ?? null, low_price_volume: point.lowPriceVolume ?? null,
      }));
      received += bars.length;
      if (bars.length) {
        const result = await sql`insert into market_bars(item_id,timestep,bucket_at,avg_high_price,avg_low_price,high_price_volume,low_price_volume)
          select x.item_id,'5m',x.bucket_at::timestamptz,x.avg_high_price,x.avg_low_price,x.high_price_volume,x.low_price_volume
          from jsonb_to_recordset(${JSON.stringify(bars)}::jsonb) as x(item_id integer,bucket_at text,avg_high_price numeric,avg_low_price numeric,high_price_volume bigint,low_price_volume bigint)
          on conflict(item_id,timestep,bucket_at) do update set avg_high_price=excluded.avg_high_price,avg_low_price=excluded.avg_low_price,high_price_volume=excluded.high_price_volume,low_price_volume=excluded.low_price_volume,ingested_at=now() returning item_id`;
        upserted += result.length;
      }
      completed++;
      await sleep(delayMs);
    }
    async function worker() {
      while (cursor < candidates.length) {
        const item = candidates[cursor++];
        try { await ingest(item); }
        catch (error) { failed++; console.error(`Market history failed for ${item.name}`, error); await sleep(delayMs*2); }
      }
    }
    await Promise.all(Array.from({length: concurrency}, worker));
    await sql`update market_ingestion_runs set status='COMPLETED',completed_at=now(),completed_items=${completed},failed_items=${failed},bars_received=${received},bars_upserted=${upserted} where id=${runId}`;
    await sql`insert into model_item_eligibility(item_id,timestep,eligible,quality_score,bar_count,expected_bar_count,coverage_ratio,median_volume,stale_ratio,gap_count,first_bar_at,last_bar_at,reason,evaluated_at)
      select q.item_id,'5m',q.bar_count>=300 and q.quality_score>=0.85 and q.median_volume>=1000 and q.stale_ratio<=0.05,q.quality_score,q.bar_count,greatest(1,floor(extract(epoch from(q.last_bar_at-q.first_bar_at))/300)::integer+1),least(1::numeric,q.bar_count::numeric/nullif(greatest(1,floor(extract(epoch from(q.last_bar_at-q.first_bar_at))/300)::integer+1),0)),q.median_volume,q.stale_ratio,q.gap_count,q.first_bar_at,q.last_bar_at,case when q.bar_count<300 then 'INSUFFICIENT_HISTORY' when q.quality_score<0.85 then 'LOW_DATA_QUALITY' when q.median_volume<1000 then 'LOW_LIQUIDITY' when q.stale_ratio>0.05 then 'MISSING_PRICES' else 'ELIGIBLE' end,now() from market_bar_quality q where q.timestep='5m'
      on conflict(item_id,timestep) do update set eligible=excluded.eligible,quality_score=excluded.quality_score,bar_count=excluded.bar_count,expected_bar_count=excluded.expected_bar_count,coverage_ratio=excluded.coverage_ratio,median_volume=excluded.median_volume,stale_ratio=excluded.stale_ratio,gap_count=excluded.gap_count,first_bar_at=excluded.first_bar_at,last_bar_at=excluded.last_bar_at,reason=excluded.reason,evaluated_at=now()`;
    const summary = await sql`select count(*)::int rows,count(distinct item_id)::int items,max(bucket_at) latest_bar_at from ml_training_rows_5m`;
    const eligible = await sql`select count(*)::int eligible_items from model_item_eligibility where timestep='5m' and eligible=true`;
    return { ok: failed === 0, skipped: false, runId, requested: candidates.length, completed, failed, barsReceived: received, barsUpserted: upserted, eligibleItems: Number((eligible[0] as {eligible_items: unknown}).eligible_items), latestBarAt: (summary[0] as {latest_bar_at: unknown}).latest_bar_at, durationMs: Date.now()-startedAt };
  } catch (error) {
    if (runId) await sql`update market_ingestion_runs set status='FAILED',completed_at=now(),completed_items=${completed},failed_items=${failed},bars_received=${received},bars_upserted=${upserted},error_summary=${String(error).slice(0,1000)} where id=${runId}`;
    throw error;
  } finally { await releaseLock(token); }
}
