import { sql } from "@/lib/db";

const BASE_URL = "https://prices.runescape.wiki/api/v1/osrs";

type ApiMap = Record<string, Record<string, unknown>>;
type MappingItem = Record<string, unknown>;

async function getJson(route: string) {
  const userAgent = process.env.OSRS_USER_AGENT;
  if (!userAgent) {
    throw new Error("OSRS_USER_AGENT is required.");
  }
  const response = await fetch(BASE_URL + route, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}`);
  return response.json();
}

export async function syncMarketSnapshots() {
  const observedAt = new Date().toISOString();
  const [mappingResponse, latestResponse, fiveResponse, hourResponse] =
    await Promise.all([
      getJson("/mapping"),
      getJson("/latest"),
      getJson("/5m"),
      getJson("/1h"),
    ]);

  const mapping = mappingResponse as MappingItem[];
  const items = mapping.map((item) => ({
    id: Number(item.id),
    name: String(item.name),
    examine: item.examine ?? null,
    members: Boolean(item.members),
    low_alchemy: item.lowalch ?? null,
    high_alchemy: item.highalch ?? null,
    store_value: item.value ?? null,
    buy_limit: item.limit ?? null,
    icon_name: item.icon ?? null,
  })).filter((item) => Number.isInteger(item.id));

  await sql`insert into items(id,name,examine,members,low_alchemy,high_alchemy,store_value,buy_limit,icon_name,active,metadata_updated_at)
    select x.id,x.name,x.examine,x.members,x.low_alchemy,x.high_alchemy,x.store_value,x.buy_limit,x.icon_name,true,now()
    from jsonb_to_recordset(${JSON.stringify(items)}::jsonb) as x(id integer,name text,examine text,members boolean,low_alchemy bigint,high_alchemy bigint,store_value bigint,buy_limit integer,icon_name text)
    on conflict(id) do update set name=excluded.name,examine=excluded.examine,members=excluded.members,low_alchemy=excluded.low_alchemy,high_alchemy=excluded.high_alchemy,store_value=excluded.store_value,buy_limit=excluded.buy_limit,icon_name=excluded.icon_name,active=true,metadata_updated_at=now()`;

  const latest = ((latestResponse as { data?: ApiMap }).data ?? {});
  const five = ((fiveResponse as { data?: ApiMap }).data ?? {});
  const hour = ((hourResponse as { data?: ApiMap }).data ?? {});
  const ids = new Set([...Object.keys(latest), ...Object.keys(five), ...Object.keys(hour)]);
  const snapshots = [...ids].map((id) => {
    const current = latest[id] ?? {};
    const fiveMinute = five[id] ?? {};
    const oneHour = hour[id] ?? {};
    return {
      item_id: Number(id),
      latest_high: current.high ?? null,
      latest_high_time: current.highTime ?? null,
      latest_low: current.low ?? null,
      latest_low_time: current.lowTime ?? null,
      average_high_5m: fiveMinute.avgHighPrice ?? null,
      average_low_5m: fiveMinute.avgLowPrice ?? null,
      high_volume_5m: fiveMinute.highPriceVolume ?? null,
      low_volume_5m: fiveMinute.lowPriceVolume ?? null,
      average_high_1h: oneHour.avgHighPrice ?? null,
      average_low_1h: oneHour.avgLowPrice ?? null,
      high_volume_1h: oneHour.highPriceVolume ?? null,
      low_volume_1h: oneHour.lowPriceVolume ?? null,
    };
  }).filter((row) => Number.isInteger(row.item_id));

  const inserted = await sql`insert into market_snapshots(item_id,observed_at,latest_high,latest_high_time,latest_low,latest_low_time,average_high_5m,average_low_5m,high_volume_5m,low_volume_5m,average_high_1h,average_low_1h,high_volume_1h,low_volume_1h,source)
    select x.item_id,${observedAt}::timestamptz,x.latest_high,case when x.latest_high_time is null then null else to_timestamp(x.latest_high_time) end,x.latest_low,case when x.latest_low_time is null then null else to_timestamp(x.latest_low_time) end,x.average_high_5m,x.average_low_5m,x.high_volume_5m,x.low_volume_5m,x.average_high_1h,x.average_low_1h,x.high_volume_1h,x.low_volume_1h,'OSRS_WIKI'
    from jsonb_to_recordset(${JSON.stringify(snapshots)}::jsonb) as x(item_id integer,latest_high bigint,latest_high_time bigint,latest_low bigint,latest_low_time bigint,average_high_5m numeric,average_low_5m numeric,high_volume_5m bigint,low_volume_5m bigint,average_high_1h numeric,average_low_1h numeric,high_volume_1h bigint,low_volume_1h bigint)
    join items on items.id=x.item_id returning id`;

  if (inserted.length === 0) throw new Error("Snapshot synchronization inserted zero rows.");
  return { itemsUpserted: items.length, snapshotsInserted: inserted.length, observedAt };
}
