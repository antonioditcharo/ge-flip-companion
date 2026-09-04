create or replace view recommendation_outcomes as
select
  r.id as recommendation_id,
  r.batch_id,
  r.item_id,
  i.name as item_name,
  r.rank,
  r.classification,
  r.scoring_version,
  r.model_version,
  r.generated_at,
  r.expires_at,
  r.expected_profit,
  r.expected_roi,
  r.opportunity_score,
  r.confidence_score,
  r.liquidity_score,
  r.risk_score,
  r.active as recommendation_active,
  t.id as trade_id,
  t.status as trade_status,
  t.started_at as trade_started_at,
  t.completed_at as trade_completed_at,
  t.realized_profit,
  t.realized_roi,
  t.realized_tax,
  case
    when t.id is null and r.expires_at <= now() then 'EXPIRED'
    when t.id is null then 'NOT_STARTED'
    when t.status = 'COMPLETED' and coalesce(t.realized_profit, 0) >= 0 then 'COMPLETED_PROFIT'
    when t.status = 'COMPLETED' then 'COMPLETED_LOSS'
    when t.status = 'CANCELLED' then 'CANCELLED'
    else 'ACTIVE'
  end as outcome_status,
  case when t.status = 'COMPLETED' then t.realized_profit-r.expected_profit end as profit_error,
  case when t.status = 'COMPLETED' then t.realized_roi-r.expected_roi end as roi_error
from recommendations r
join items i on i.id=r.item_id
left join trades t on t.recommendation_id=r.id;
