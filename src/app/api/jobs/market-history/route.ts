import { timingSafeEqual } from "node:crypto";
import { runMarketHistoryJob } from "@/lib/jobs/market-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request) {
  const secret =
    process.env.CRON_SECRET ??
    process.env.MARKET_CRON_SECRET;
  const value = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(value);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
async function handler(request: Request) {
  if (!authorized(request)) return Response.json({ok:false,error:"Unauthorized"},{status:401});
  try {
    const result = await runMarketHistoryJob({owner: request.headers.get("user-agent") ?? "external-http", concurrency:4, delayMs:200});
    return Response.json(result,{status:result.ok?200:207,headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    console.error("Protected market-history job failed",error);
    return Response.json({ok:false,error:"Market history job failed"},{status:500,headers:{"Cache-Control":"no-store"}});
  }
}
export const GET = handler;
export const POST = handler;
