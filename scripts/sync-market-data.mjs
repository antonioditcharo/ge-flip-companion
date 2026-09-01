import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";

dotenv.config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!databaseUrl) throw new Error("DATABASE_URL or POSTGRES_URL is missing.");

const userAgent = process.env.OSRS_USER_AGENT ?? "GE Flip Companion - antonioditcharo on GitHub";
const baseUrl = "https://prices.runescape.wiki/api/v1/osrs";
const sql = neon(databaseUrl);

async function getJson(route) {
  const response = await fetch(baseUrl + route, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`${route} returned ${response.status} ${response.statusText}`);
  return response.json();
}

console.log("Downloading OSRS item mapping and price data...");
const [mapping, latestResponse, fiveMinuteResponse] = await Promise.all([
  getJson("/mapping"),
  getJson("/latest"),
  getJson("/5m"),
]);

const items = mapping.map((item) => ({
  id: item.id,
  name: item.name,
  examine: item.examine ?? null,
  members: Boolean(item.members),
  lowAlchemy: item.lowalch ?? null,
  highAlchemy: item.highalch ?? null,
  storeValue: item.value ?? null,
  buyLimit: item.limit ?? null,
  iconName: item.icon ?? null,
}));

await sql`
  insert into items (
    id, name, examine, members, low_alchemy, high_alchemy,
    store_value, buy_limit, icon_name, active, metadata_updated_at
  )
  select
    x.id, x.name, x.examine, x.members, x.low_alchemy, x.high_alchemy,
    x.store_value, x.buy_limit, x.icon_name, true, now()
  from jsonb_to_recordset(${JSON.stringify(items)}::jsonb) as x(
    id integer,
    name text,
    examine text,
    members boolean,
    low_alchemy bigint,
    high_alchemy bigint,
    store_value bigint,
    buy_limit integer,
    icon_name text
  )
  on conflict (id) do update set
    name = excluded.name,
    examine = excluded.examine,
    members = excluded.members,
    low_alchemy = excluded.low_alchemy,
    high_alchemy = excluded.high_alchemy,
    store_value = excluded.store_value,
    buy_limit = excluded.buy_limit,
    icon_name = excluded.icon_name,
    active = true,
    metadata_updated_at = now()
`;

const latest = latestResponse.data ?? {};
const fiveMinute = fiveMinuteResponse.data ?? {};
const snapshotIds = new Set([...Object.keys(latest), ...Object.keys(fiveMinute)]);
const snapshots = [...snapshotIds].map((id) => {
  const current = latest[id] ?? {};
  const average = fiveMinute[id] ?? {};
  return {
    item_id: Number(id),
    latest_high: current.high ?? null,
    latest_high_time: current.highTime ?? null,
    latest_low: current.low ?? null,
    latest_low_time: current.lowTime ?? null,
    average_high_5m: average.avgHighPrice ?? null,
    average_low_5m: average.avgLowPrice ?? null,
    high_volume_5m: average.highPriceVolume ?? null,
    low_volume_5m: average.lowPriceVolume ?? null,
  };
}).filter((row) => Number.isInteger(row.item_id));

await sql`
  insert into market_snapshots (
    item_id, observed_at, latest_high, latest_high_time,
    latest_low, latest_low_time, average_high_5m, average_low_5m,
    high_volume_5m, low_volume_5m, source
  )
  select
    x.item_id,
    now(),
    x.latest_high,
    case when x.latest_high_time is null then null else to_timestamp(x.latest_high_time) end,
    x.latest_low,
    case when x.latest_low_time is null then null else to_timestamp(x.latest_low_time) end,
    x.average_high_5m,
    x.average_low_5m,
    x.high_volume_5m,
    x.low_volume_5m,
    'OSRS_WIKI'
  from jsonb_to_recordset(${JSON.stringify(snapshots)}::jsonb) as x(
    item_id integer,
    latest_high bigint,
    latest_high_time bigint,
    latest_low bigint,
    latest_low_time bigint,
    average_high_5m numeric,
    average_low_5m numeric,
    high_volume_5m bigint,
    low_volume_5m bigint
  )
  inner join items on items.id = x.item_id
`;

console.log(`Synced ${items.length} items and ${snapshots.length} market snapshots.`);
