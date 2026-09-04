do $migration$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trades'
      and column_name = 'realized_tax'
  ) then
    alter table trades
      add column realized_tax bigint not null default 0;

    with event_totals as (
      select
        trade_id,
        coalesce(
          sum(unit_price::numeric * quantity)
            filter (where event_type = 'BUY_FILL'),
          0
        ) as exact_buy_cost,
        coalesce(
          sum(unit_price::numeric * quantity)
            filter (where event_type = 'SELL_FILL'),
          0
        ) as exact_gross_proceeds,
        coalesce(
          sum(
            least(
              5000000::numeric,
              floor(unit_price::numeric * 0.02)
            ) * quantity
          ) filter (where event_type = 'SELL_FILL'),
          0
        ) as exact_tax
      from trade_events
      group by trade_id
    ),
    corrections as (
      select
        t.id,
        e.exact_tax::bigint as corrected_tax,
        (
          e.exact_gross_proceeds
          - e.exact_tax
          - e.exact_buy_cost
        )::bigint as corrected_profit,
        case
          when e.exact_buy_cost > 0 then
            (
              e.exact_gross_proceeds
              - e.exact_tax
              - e.exact_buy_cost
            ) / e.exact_buy_cost
          else null
        end as corrected_roi,
        (
          e.exact_gross_proceeds
          - e.exact_tax
          - e.exact_buy_cost
          - coalesce(t.realized_profit, 0)
        )::bigint as profit_delta
      from trades t
      join event_totals e on e.trade_id = t.id
      where t.status = 'COMPLETED'
    ),
    updated as (
      update trades t
      set
        realized_tax = corrections.corrected_tax,
        realized_profit = corrections.corrected_profit,
        realized_roi = corrections.corrected_roi,
        updated_at = now()
      from corrections
      where t.id = corrections.id
      returning corrections.profit_delta
    )
    update app_settings
    set
      cash_stack = cash_stack + coalesce(
        (select sum(profit_delta) from updated),
        0
      ),
      updated_at = now()
    where id = 1;

    alter table trades
      add constraint realized_tax_not_negative
      check (realized_tax >= 0);
  end if;
end
$migration$;
