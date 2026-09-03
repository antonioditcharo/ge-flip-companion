
create table if not exists market_bars (
  item_id integer not null references items(id) on delete cascade,
  timestep text not null check (timestep in ('5m','1h','6h','24h')),
  bucket_at timestamptz not null,
  avg_high_price numeric(20,4),
  avg_low_price numeric(20,4),
  high_price_volume bigint,
  low_price_volume bigint,
  midpoint numeric(20,4) generated always as (
    case when avg_high_price is not null and avg_low_price is not null
      then (avg_high_price + avg_low_price) / 2.0 else null end
  ) stored,
  spread numeric(20,4) generated always as (
    case when avg_high_price is not null and avg_low_price is not null
      then avg_high_price - avg_low_price else null end
  ) stored,
  total_volume bigint generated always as (
    coalesce(high_price_volume,0) + coalesce(low_price_volume,0)
  ) stored,
  source text not null default 'OSRS_WIKI',
  ingested_at timestamptz not null default now(),
  primary key (item_id,timestep,bucket_at)
);

create index if not exists market_bars_timestep_time_idx
  on market_bars(timestep,bucket_at desc);
create index if not exists market_bars_item_time_idx
  on market_bars(item_id,bucket_at desc);

create table if not exists market_ingestion_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'RUNNING' check(status in ('RUNNING','COMPLETED','FAILED')),
  timestep text not null,
  requested_items integer not null default 0,
  completed_items integer not null default 0,
  failed_items integer not null default 0,
  bars_received integer not null default 0,
  bars_upserted integer not null default 0,
  error_summary text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists model_item_eligibility (
  item_id integer primary key references items(id) on delete cascade,
  eligible boolean not null default false,
  quality_score numeric(8,4) not null default 0,
  bar_count integer not null default 0,
  coverage_ratio numeric(8,6) not null default 0,
  median_volume numeric(20,4) not null default 0,
  stale_ratio numeric(8,6) not null default 1,
  first_bar_at timestamptz,
  last_bar_at timestamptz,
  reason text,
  evaluated_at timestamptz not null default now()
);

create or replace view market_bar_quality as
with ranked as (
  select b.*,
    lag(bucket_at) over(partition by item_id,timestep order by bucket_at) previous_bucket
  from market_bars b
), aggregates as (
  select item_id,timestep,count(*)::integer bar_count,
    min(bucket_at) first_bar_at,max(bucket_at) last_bar_at,
    percentile_cont(0.5) within group(order by total_volume)::numeric median_volume,
    count(*) filter(where avg_high_price is null or avg_low_price is null)::numeric / nullif(count(*),0) stale_ratio,
    count(*) filter(where previous_bucket is not null and bucket_at-previous_bucket >
      case timestep when '5m' then interval '10 minutes' when '1h' then interval '2 hours'
      when '6h' then interval '12 hours' else interval '48 hours' end)::integer gap_count
  from ranked group by item_id,timestep
)
select *,
  least(1::numeric,bar_count/300.0) *
  greatest(0::numeric,1-stale_ratio) *
  greatest(0::numeric,1-least(1::numeric,gap_count::numeric/nullif(bar_count,0))) quality_score
from aggregates;

