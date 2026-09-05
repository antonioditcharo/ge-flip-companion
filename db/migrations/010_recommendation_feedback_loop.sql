create table if not exists recommendation_batches (
  id uuid primary key default gen_random_uuid(),
  generated_at timestamptz not null default now(),
  market_observed_at timestamptz not null,
  source text not null,
  scoring_version text not null,
  model_version text not null,
  candidate_count integer not null default 0 check (candidate_count >= 0),
  recommendation_count integer not null default 0 check (recommendation_count >= 0),
  settings_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists recommendation_batches_generated_idx
  on recommendation_batches (generated_at desc);

alter table recommendations
  add column if not exists batch_id uuid references recommendation_batches(id) on delete cascade,
  add column if not exists rank integer,
  add column if not exists classification text,
  add column if not exists scoring_version text not null default 'trade-finder-v2',
  add column if not exists market_snapshot_id bigint references market_snapshots(id) on delete set null,
  add column if not exists quote_age_minutes numeric(12,4),
  add column if not exists price_deviation numeric(12,8),
  add column if not exists volume_5m bigint,
  add column if not exists volume_1h bigint,
  add column if not exists reason_codes jsonb not null default '[]'::jsonb;

do $constraints$
begin
  if not exists (select 1 from pg_constraint where conname = 'recommendations_rank_positive') then
    alter table recommendations add constraint recommendations_rank_positive check (rank is null or rank > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recommendations_classification_valid') then
    alter table recommendations add constraint recommendations_classification_valid
      check (classification is null or classification in ('High confidence','Balanced','Speculative'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recommendations_quote_age_nonnegative') then
    alter table recommendations add constraint recommendations_quote_age_nonnegative
      check (quote_age_minutes is null or quote_age_minutes >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recommendations_price_deviation_nonnegative') then
    alter table recommendations add constraint recommendations_price_deviation_nonnegative
      check (price_deviation is null or price_deviation >= 0);
  end if;
end
$constraints$;

create unique index if not exists recommendations_batch_rank_unique
  on recommendations (batch_id, rank)
  where batch_id is not null;

create index if not exists recommendations_latest_batch_idx
  on recommendations (batch_id, rank)
  where active = true;

create or replace function generate_recommendation_batch(
  p_source text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  batch_id uuid,
  candidate_count integer,
  recommendation_count integer
)
language plpgsql
as $function$
declare
  v_batch_id uuid := gen_random_uuid();
  v_market_observed_at timestamptz;
  v_candidate_count integer := 0;
  v_recommendation_count integer := 0;
  v_settings jsonb;
begin
  if coalesce(trim(p_source), '') = '' then
    raise exception 'Recommendation source is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('ge-flip-recommendation-generation'));

  select max(observed_at) into v_market_observed_at from market_snapshots;
  if v_market_observed_at is null then
    raise exception 'No market snapshots are available.';
  end if;

  select to_jsonb(s) into v_settings from app_settings s where s.id = 1;
  if v_settings is null then
    raise exception 'Application settings were not found.';
  end if;

  create temporary table recommendation_candidates on commit drop as
  with settings as (
    select account_mode, cash_stack, minimum_profit, minimum_roi, maximum_capital_percent
    from app_settings where id = 1
  ), portfolio as (
    select coalesce(sum(capital_committed), 0) as committed
    from trades where status not in ('COMPLETED','CANCELLED')
  ), latest_snapshot as (
    select distinct on (ms.item_id)
      ms.id as market_snapshot_id, ms.item_id, ms.observed_at,
      ms.latest_high, ms.latest_high_time, ms.latest_low, ms.latest_low_time,
      ms.average_high_5m, ms.average_low_5m,
      ms.high_volume_5m, ms.low_volume_5m,
      ms.average_high_1h, ms.average_low_1h,
      ms.high_volume_1h, ms.low_volume_1h
    from market_snapshots ms
    order by ms.item_id, ms.observed_at desc
  ), candidates as (
    select i.id as item_id, i.name, i.members, i.buy_limit,
      ls.market_snapshot_id, ls.observed_at,
      ls.latest_low as buy_price, ls.latest_high as sell_price,
      ls.latest_low_time, ls.latest_high_time,
      ls.average_low_5m, ls.average_high_5m,
      ls.average_low_1h, ls.average_high_1h,
      coalesce(ls.high_volume_5m,0)+coalesce(ls.low_volume_5m,0) as volume_5m,
      coalesce(ls.high_volume_1h,0)+coalesce(ls.low_volume_1h,0) as volume_1h,
      greatest(0::numeric, s.cash_stack-p.committed) as liquid_cash,
      s.minimum_profit, s.minimum_roi, s.maximum_capital_percent
    from latest_snapshot ls
    join items i on i.id = ls.item_id
    cross join settings s
    cross join portfolio p
    where ls.latest_low > 0
      and ls.latest_high > ls.latest_low
      and ls.latest_low_time >= now()-interval '24 hours'
      and ls.latest_high_time >= now()-interval '24 hours'
      and (s.account_mode='P2P' or i.members=false)
  ), measured as (
    select *, least(5000000::numeric,floor(sell_price*0.02)) as tax_per_item,
      greatest(extract(epoch from(now()-least(latest_low_time,latest_high_time)))/60,0) as quote_age_minutes,
      case
        when average_low_1h>0 and average_high_1h>0 then greatest(abs(buy_price-average_low_1h)/average_low_1h,abs(sell_price-average_high_1h)/average_high_1h)
        when average_low_5m>0 and average_high_5m>0 then greatest(abs(buy_price-average_low_5m)/average_low_5m,abs(sell_price-average_high_5m)/average_high_5m)
        else 1
      end as price_deviation
    from candidates
  ), sized as (
    select *, greatest(0,sell_price-tax_per_item-buy_price) as net_profit_each,
      least(
        coalesce(buy_limit,1),
        greatest(1,floor((least(liquid_cash, liquid_cash*maximum_capital_percent/100))/buy_price)::integer),
        greatest(1,least(coalesce(nullif(volume_5m,0),1),greatest(1,floor(coalesce(volume_1h,0)/12)::integer)))
      ) as quantity
    from measured
  ), scored as (
    select *, net_profit_each*quantity as total_profit,
      case when buy_price>0 then net_profit_each::numeric/buy_price else 0 end as roi,
      least(100,greatest(0,18*ln(greatest(volume_1h,1))+8*ln(greatest(volume_5m,1)))) as liquidity_score,
      least(100,greatest(0,100-quote_age_minutes/6-price_deviation*220)) as confidence_score,
      least(100,greatest(0,25+price_deviation*250+case when volume_5m<5 then 25 else 0 end+case when volume_1h<25 then 20 else 0 end+case when buy_limit is null then 10 else 0 end)) as risk_score
    from sized where net_profit_each>0
  ), ranked as (
    select *, least(100,greatest(0,liquidity_score*0.35+least(100,roi*1000)*0.25+least(100,ln(greatest(total_profit,1))*5)*0.20+confidence_score*0.20-risk_score*0.15)) as opportunity_score
    from scored
    where total_profit>=minimum_profit and roi>=minimum_roi and volume_1h>0 and price_deviation<=0.35
  )
  select *, row_number() over(order by opportunity_score desc,total_profit desc,item_id)::integer as recommendation_rank,
    case when liquidity_score>=70 and confidence_score>=65 and risk_score<=45 then 'High confidence'
         when liquidity_score>=40 and confidence_score>=40 and risk_score<=70 then 'Balanced'
         else 'Speculative' end as classification
  from ranked;

  select count(*)::integer into v_candidate_count from recommendation_candidates;

  insert into recommendation_batches(
    id, market_observed_at, source, scoring_version, model_version,
    candidate_count, recommendation_count, settings_snapshot, metadata
  ) values (
    v_batch_id, v_market_observed_at, p_source, 'trade-finder-v2', 'rules-v1',
    v_candidate_count, least(v_candidate_count,40), v_settings, coalesce(p_metadata,'{}'::jsonb)
  );

  update recommendations set active=false where active=true;

  insert into recommendations(
    item_id, generated_at, expires_at,
    recommended_buy_price, recommended_sell_price, recommended_quantity,
    capital_required, expected_profit, expected_roi,
    liquidity_score, volatility_score, risk_score, confidence_score, opportunity_score,
    estimated_buy_minutes, estimated_sell_minutes, explanation, invalidation_reason,
    model_version, active, batch_id, rank, classification, scoring_version,
    market_snapshot_id, quote_age_minutes, price_deviation, volume_5m, volume_1h, reason_codes
  )
  select item_id, now(), now()+interval '30 minutes',
    buy_price::bigint, sell_price::bigint, quantity,
    (buy_price*quantity)::bigint, total_profit::bigint, roi,
    liquidity_score, least(100,price_deviation*100), risk_score, confidence_score, opportunity_score,
    null, null,
    classification || ' opportunity with ' || total_profit::text || ' GP expected profit and ' || round(roi*100,2)::text || '% expected ROI.',
    null, 'rules-v1', true, v_batch_id, recommendation_rank, classification, 'trade-finder-v2',
    market_snapshot_id, quote_age_minutes, price_deviation, volume_5m, volume_1h,
    jsonb_build_array(
      case when liquidity_score>=70 then 'HIGH_LIQUIDITY' else 'LIMITED_LIQUIDITY' end,
      case when confidence_score>=65 then 'FRESH_CONSISTENT_QUOTES' else 'LOWER_QUOTE_CONFIDENCE' end,
      case when risk_score<=45 then 'LOWER_RISK' else 'ELEVATED_RISK' end
    )
  from recommendation_candidates
  where recommendation_rank<=40
  order by recommendation_rank;

  get diagnostics v_recommendation_count = row_count;

  update recommendation_batches
  set recommendation_count=v_recommendation_count
  where id=v_batch_id;

  return query select v_batch_id,v_candidate_count,v_recommendation_count;
end
$function$;
