drop view if exists ml_training_rows_5m;

alter table model_item_eligibility rename to model_item_eligibility_legacy;
create table model_item_eligibility (
 item_id integer not null references items(id) on delete cascade,
 timestep text not null check(timestep in ('5m','1h','6h','24h')),
 eligible boolean not null default false,
 quality_score numeric(8,4) not null default 0,
 bar_count integer not null default 0,
 expected_bar_count integer not null default 0,
 coverage_ratio numeric(8,6) not null default 0,
 median_volume numeric(20,4) not null default 0,
 stale_ratio numeric(8,6) not null default 1,
 gap_count integer not null default 0,
 first_bar_at timestamptz,last_bar_at timestamptz,reason text,
 evaluated_at timestamptz not null default now(),
 primary key(item_id,timestep)
);
insert into model_item_eligibility(item_id,timestep,eligible,quality_score,bar_count,expected_bar_count,coverage_ratio,median_volume,stale_ratio,first_bar_at,last_bar_at,reason,evaluated_at)
select item_id,'5m',eligible,quality_score,bar_count,bar_count,coverage_ratio,median_volume,stale_ratio,first_bar_at,last_bar_at,reason,evaluated_at from model_item_eligibility_legacy
on conflict do nothing;
drop table model_item_eligibility_legacy;

create table if not exists ml_dataset_exports(
 id bigserial primary key,dataset_version text not null,timestep text not null,
 created_at timestamptz not null default now(),row_count integer not null,
 first_bar_at timestamptz,last_bar_at timestamptz,train_end_at timestamptz,
 validation_end_at timestamptz,feature_schema jsonb not null,metadata jsonb not null default '{}'::jsonb
);

create or replace view ml_training_rows_5m as
with base as(
 select b.item_id,i.name item_name,b.bucket_at,b.midpoint::double precision midpoint,
 b.spread::double precision/nullif(b.midpoint::double precision,0) spread_pct,
 b.total_volume::double precision total_volume,
 (coalesce(b.high_price_volume,0)-coalesce(b.low_price_volume,0))::double precision/nullif(b.total_volume::double precision,0) volume_imbalance,
 lag(b.bucket_at,12) over(partition by b.item_id order by b.bucket_at) t_lag12,
 lag(b.midpoint,1) over(partition by b.item_id order by b.bucket_at)::double precision m1,
 lag(b.midpoint,3) over(partition by b.item_id order by b.bucket_at)::double precision m3,
 lag(b.midpoint,6) over(partition by b.item_id order by b.bucket_at)::double precision m6,
 lag(b.midpoint,12) over(partition by b.item_id order by b.bucket_at)::double precision m12,
 lag(b.spread::double precision/nullif(b.midpoint::double precision,0),1) over(partition by b.item_id order by b.bucket_at) spread_prev,
 avg(b.total_volume::double precision) over(partition by b.item_id order by b.bucket_at rows between 11 preceding and current row) volume_mean_1h,
 stddev_samp(ln(b.midpoint::double precision/nullif(lag_midpoint,0))) over(partition by b.item_id order by b.bucket_at rows between 11 preceding and current row) volatility_1h
 from (select x.*,lag(midpoint) over(partition by item_id order by bucket_at)::double precision lag_midpoint from market_bars x where timestep='5m') b
 join items i on i.id=b.item_id
), labels as(
 select b.*,
 ln(f15.midpoint::double precision/nullif(b.midpoint,0)) target_return_15m,
 ln(f30.midpoint::double precision/nullif(b.midpoint,0)) target_return_30m,
 ln(f60.midpoint::double precision/nullif(b.midpoint,0)) target_return_60m,
 ln(f240.midpoint::double precision/nullif(b.midpoint,0)) target_return_240m
 from base b
 left join market_bars f15 on f15.item_id=b.item_id and f15.timestep='5m' and f15.bucket_at=b.bucket_at+interval '15 minutes'
 left join market_bars f30 on f30.item_id=b.item_id and f30.timestep='5m' and f30.bucket_at=b.bucket_at+interval '30 minutes'
 left join market_bars f60 on f60.item_id=b.item_id and f60.timestep='5m' and f60.bucket_at=b.bucket_at+interval '60 minutes'
 left join market_bars f240 on f240.item_id=b.item_id and f240.timestep='5m' and f240.bucket_at=b.bucket_at+interval '240 minutes'
)
select item_id,item_name,bucket_at,midpoint,spread_pct,total_volume,volume_imbalance,
 ln(midpoint/nullif(m1,0)) return_5m,ln(midpoint/nullif(m3,0)) momentum_15m,
 ln(midpoint/nullif(m6,0)) momentum_30m,ln(midpoint/nullif(m12,0)) momentum_60m,
 spread_pct-spread_prev spread_change_5m,volume_mean_1h,volatility_1h,
 sin(2*pi()*extract(hour from bucket_at)/24.0) hour_sin,
 cos(2*pi()*extract(hour from bucket_at)/24.0) hour_cos,
 target_return_15m,target_return_30m,target_return_60m,target_return_240m,
 (t_lag12=bucket_at-interval '60 minutes') history_contiguous_1h
from labels;
