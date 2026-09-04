import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";

dotenv.config({ path: ".env.local" });

const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL or POSTGRES_URL was not found in .env.local.",
  );
}

const sql = neon(databaseUrl);

console.log("Starting database setup...");

await sql`
  create extension if not exists pgcrypto
`;

await sql`
  create table if not exists app_settings (
    id integer primary key default 1,
    display_name text not null default 'Player',

    account_mode text not null default 'P2P'
      check (account_mode in ('F2P', 'P2P')),

    cash_stack bigint not null default 1000000
      check (cash_stack >= 0),

    risk_tolerance text not null default 'BALANCED'
      check (
        risk_tolerance in (
          'CONSERVATIVE',
          'BALANCED',
          'AGGRESSIVE'
        )
      ),

    minimum_profit bigint not null default 10000
      check (minimum_profit >= 0),

    minimum_roi numeric(10, 4) not null default 0.01
      check (minimum_roi >= 0),

    maximum_capital_percent numeric(5, 2) not null default 20
      check (
        maximum_capital_percent > 0
        and maximum_capital_percent <= 100
      ),

    updated_at timestamptz not null default now(),

    constraint single_settings_row
      check (id = 1)
  )
`;

await sql`
  insert into app_settings (id)
  values (1)
  on conflict (id) do nothing
`;

await sql`
  create table if not exists items (
    id integer primary key,
    name text not null,
    examine text,
    members boolean not null default false,
    low_alchemy bigint,
    high_alchemy bigint,
    store_value bigint,
    buy_limit integer,
    icon_name text,
    active boolean not null default true,
    metadata_updated_at timestamptz not null default now()
  )
`;

await sql`
  create index if not exists items_name_idx
    on items (name)
`;

await sql`
  create index if not exists items_members_idx
    on items (members)
`;

await sql`
  create table if not exists market_snapshots (
    id bigint generated always as identity primary key,

    item_id integer not null
      references items(id)
      on delete cascade,

    observed_at timestamptz not null default now(),

    latest_high bigint,
    latest_high_time timestamptz,

    latest_low bigint,
    latest_low_time timestamptz,

    average_high_5m numeric,
    average_low_5m numeric,
    high_volume_5m bigint,
    low_volume_5m bigint,

    average_high_1h numeric,
    average_low_1h numeric,
    high_volume_1h bigint,
    low_volume_1h bigint,

    source text not null default 'OSRS_WIKI'
  )
`;

await sql`
  create index if not exists market_snapshots_item_time_idx
    on market_snapshots (item_id, observed_at desc)
`;

await sql`
  create table if not exists recommendations (
    id uuid primary key default gen_random_uuid(),

    item_id integer not null
      references items(id)
      on delete cascade,

    generated_at timestamptz not null default now(),
    expires_at timestamptz not null,

    recommended_buy_price bigint not null
      check (recommended_buy_price > 0),

    recommended_sell_price bigint not null
      check (recommended_sell_price > 0),

    recommended_quantity integer not null
      check (recommended_quantity > 0),

    capital_required bigint not null
      check (capital_required >= 0),

    expected_profit bigint not null,
    expected_roi numeric(12, 6) not null,

    liquidity_score numeric(5, 2) not null
      check (liquidity_score between 0 and 100),

    volatility_score numeric(5, 2) not null
      check (volatility_score between 0 and 100),

    risk_score numeric(5, 2) not null
      check (risk_score between 0 and 100),

    confidence_score numeric(5, 2) not null
      check (confidence_score between 0 and 100),

    opportunity_score numeric(5, 2) not null
      check (opportunity_score between 0 and 100),

    estimated_buy_minutes integer,
    estimated_sell_minutes integer,

    explanation text not null,
    invalidation_reason text,

    model_version text not null default 'rules-v1',
    active boolean not null default true
  )
`;

await sql`
  create index if not exists recommendations_current_idx
    on recommendations (
      active,
      expires_at,
      opportunity_score desc
    )
`;

await sql`
  create table if not exists trades (
    id uuid primary key default gen_random_uuid(),

    item_id integer not null
      references items(id),

    recommendation_id uuid
      references recommendations(id)
      on delete set null,

    slot_number integer not null
      check (slot_number between 1 and 8),

    status text not null default 'BUY_READY'
      check (
        status in (
          'BUY_READY',
          'BUY_PLACED',
          'PARTIALLY_BOUGHT',
          'BOUGHT',
          'SELL_READY',
          'SELL_PLACED',
          'PARTIALLY_SOLD',
          'COMPLETED',
          'CANCELLED'
        )
      ),

    planned_quantity integer not null
      check (planned_quantity > 0),

    quantity_bought integer not null default 0
      check (quantity_bought >= 0),

    quantity_sold integer not null default 0
      check (quantity_sold >= 0),

    suggested_buy_price bigint not null
      check (suggested_buy_price > 0),

    suggested_sell_price bigint not null
      check (suggested_sell_price > 0),

    average_buy_price numeric,
    average_sell_price numeric,

    capital_committed bigint not null default 0
      check (capital_committed >= 0),

    expected_profit bigint not null default 0,
    realized_profit bigint,

    realized_tax bigint not null default 0
      check (realized_tax >= 0),

    expected_roi numeric(12, 6),
    realized_roi numeric(12, 6),

    current_instruction text,
    needs_attention boolean not null default false,

    started_at timestamptz not null default now(),
    buy_completed_at timestamptz,
    sell_started_at timestamptz,
    completed_at timestamptz,
    updated_at timestamptz not null default now(),

    constraint bought_not_above_plan
      check (quantity_bought <= planned_quantity),

    constraint sold_not_above_bought
      check (quantity_sold <= quantity_bought)
  )
`;

await sql`
  create unique index if not exists unique_active_slot
    on trades (slot_number)
    where status not in ('COMPLETED', 'CANCELLED')
`;

await sql`
  create table if not exists trade_events (
    id uuid primary key default gen_random_uuid(),

    trade_id uuid not null
      references trades(id)
      on delete cascade,

    event_type text not null,
    event_time timestamptz not null default now(),

    quantity integer
      check (quantity is null or quantity > 0),

    unit_price bigint
      check (unit_price is null or unit_price > 0),

    previous_status text,
    new_status text,
    note text,

    system_generated boolean not null default false
  )
`;

await sql`
  create index if not exists trade_events_trade_time_idx
    on trade_events (trade_id, event_time)
`;

await sql`
  create table if not exists alerts (
    id uuid primary key default gen_random_uuid(),

    trade_id uuid
      references trades(id)
      on delete cascade,

    item_id integer
      references items(id)
      on delete cascade,

    severity text not null
      check (
        severity in (
          'INFO',
          'WARNING',
          'CRITICAL'
        )
      ),

    alert_type text not null,
    title text not null,
    message text not null,
    recommended_action text,

    is_read boolean not null default false,
    is_resolved boolean not null default false,

    created_at timestamptz not null default now(),
    expires_at timestamptz
  )
`;

await sql`
  create index if not exists alerts_unresolved_idx
    on alerts (is_resolved, created_at desc)
`;

console.log("Database setup completed successfully.");
