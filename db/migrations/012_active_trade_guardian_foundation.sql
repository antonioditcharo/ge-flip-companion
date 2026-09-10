-- Foundation for user-recorded GE offers, live trade guidance, and alert deduplication.

alter table trades
  add column if not exists buy_offer_price bigint,
  add column if not exists buy_offer_quantity integer,
  add column if not exists buy_offer_placed_at timestamptz,
  add column if not exists buy_offer_updated_at timestamptz,
  add column if not exists sell_offer_price bigint,
  add column if not exists sell_offer_quantity integer,
  add column if not exists sell_offer_placed_at timestamptz,
  add column if not exists sell_offer_updated_at timestamptz,
  add column if not exists last_market_snapshot_id bigint references market_snapshots(id) on delete set null,
  add column if not exists last_evaluated_at timestamptz;

do $constraints$
begin
  if not exists (select 1 from pg_constraint where conname='trades_buy_offer_price_positive') then
    alter table trades add constraint trades_buy_offer_price_positive
      check (buy_offer_price is null or buy_offer_price > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='trades_buy_offer_quantity_positive') then
    alter table trades add constraint trades_buy_offer_quantity_positive
      check (buy_offer_quantity is null or buy_offer_quantity > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='trades_sell_offer_price_positive') then
    alter table trades add constraint trades_sell_offer_price_positive
      check (sell_offer_price is null or sell_offer_price > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='trades_sell_offer_quantity_positive') then
    alter table trades add constraint trades_sell_offer_quantity_positive
      check (sell_offer_quantity is null or sell_offer_quantity > 0);
  end if;
end
$constraints$;

create table if not exists trade_guidance (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references trades(id) on delete cascade,
  market_snapshot_id bigint references market_snapshots(id) on delete set null,
  evaluated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  side text not null check (side in ('BUY','SELL')),
  guidance_status text not null check (guidance_status in (
    'KEEP','WAIT','RAISE_PRICE','LOWER_PRICE','REDUCE_QUANTITY',
    'CANCEL_OR_REASSESS','EXIT_AT_BREAK_EVEN','TARGET_REACHED','STALE_DATA'
  )),
  current_offer_price bigint check (current_offer_price is null or current_offer_price > 0),
  recommended_price bigint check (recommended_price is null or recommended_price > 0),
  current_offer_quantity integer check (current_offer_quantity is null or current_offer_quantity > 0),
  recommended_quantity integer check (recommended_quantity is null or recommended_quantity >= 0),
  remaining_quantity integer not null check (remaining_quantity >= 0),
  break_even_price bigint check (break_even_price is null or break_even_price > 0),
  live_expected_profit bigint,
  live_expected_roi numeric(12,6),
  quote_age_minutes numeric(12,4) check (quote_age_minutes is null or quote_age_minutes >= 0),
  reason_codes jsonb not null default '[]'::jsonb,
  message text not null,
  active boolean not null default true,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists trade_guidance_one_active_per_side
  on trade_guidance(trade_id,side) where active=true;
create index if not exists trade_guidance_active_expiry_idx
  on trade_guidance(active,expires_at,evaluated_at desc);
create index if not exists trade_guidance_trade_time_idx
  on trade_guidance(trade_id,evaluated_at desc);

create table if not exists trade_buy_limit_windows (
  id uuid primary key default gen_random_uuid(),
  item_id integer not null references items(id) on delete cascade,
  window_started_at timestamptz not null,
  window_ends_at timestamptz not null,
  recorded_quantity integer not null default 0 check (recorded_quantity >= 0),
  manual_adjustment integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(item_id,window_started_at)
);

create or replace function set_trade_buy_limit_window_end()
returns trigger
language plpgsql
as $function$
begin
  new.window_ends_at := new.window_started_at + interval '4 hours';
  return new;
end
$function$;

drop trigger if exists trade_buy_limit_windows_set_end
  on trade_buy_limit_windows;
create trigger trade_buy_limit_windows_set_end
before insert or update of window_started_at
on trade_buy_limit_windows
for each row
execute function set_trade_buy_limit_window_end();

create index if not exists trade_buy_limit_windows_item_end_idx
  on trade_buy_limit_windows(item_id,window_ends_at desc);

alter table alerts
  add column if not exists guidance_id uuid references trade_guidance(id) on delete set null,
  add column if not exists dedupe_key text,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists last_evaluated_at timestamptz;

create unique index if not exists alerts_unresolved_dedupe_unique
  on alerts(dedupe_key)
  where dedupe_key is not null and is_resolved=false;

create index if not exists alerts_guidance_idx
  on alerts(guidance_id) where guidance_id is not null;
