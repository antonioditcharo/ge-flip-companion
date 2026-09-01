import { createElement } from "react";
import { Coins, Database, ShieldCheck, TrendingUp } from "lucide-react";
import { sql } from "@/lib/db";
import { formatGp, getSlotCapacity } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const settingsRows = await sql`
    select display_name, account_mode, cash_stack, risk_tolerance, minimum_profit
    from app_settings where id = 1 limit 1
  `;
  const totalsRows = await sql`
    select count(*) as active_count,
      coalesce(sum(capital_committed), 0) as committed_cash,
      coalesce(sum(expected_profit), 0) as expected_profit
    from trades where status not in ('COMPLETED', 'CANCELLED')
  `;
  const snapshotRows = await sql`select count(*) as snapshot_count from market_snapshots`;

  const settings = settingsRows[0];
  if (!settings) throw new Error("Application settings were not found.");

  const accountMode = String(settings.account_mode) === "F2P" ? "F2P" : "P2P";
  const slotCapacity = getSlotCapacity(accountMode);
  const activeCount = Number(totalsRows[0]?.active_count ?? 0);
  const committedCash = BigInt(String(totalsRows[0]?.committed_cash ?? 0));
  const expectedProfit = BigInt(String(totalsRows[0]?.expected_profit ?? 0));
  const availableCash = BigInt(String(settings.cash_stack)) - committedCash;
  const snapshotCount = Number(snapshotRows[0]?.snapshot_count ?? 0);

  const cards = [
    ["Available cash", formatGp(availableCash > BigInt(0) ? availableCash : BigInt(0)), Coins],
    ["Available slots", `${slotCapacity - activeCount} of ${slotCapacity}`, ShieldCheck],
    ["Expected profit", formatGp(expectedProfit), TrendingUp],
    ["Market feed", snapshotCount > 0 ? "Connected" : "Awaiting sync", Database],
  ] as const;

  return createElement("div", { className: "space-y-5" },
    createElement("section", { className: "rounded-3xl border border-stone-800 bg-[#141a17] p-6" },
      createElement("p", { className: "text-sm font-medium text-amber-400" }, accountMode + " portfolio"),
      createElement("h1", { className: "mt-1 text-3xl font-bold" }, "Welcome, " + String(settings.display_name)),
      createElement("p", { className: "mt-2 text-sm text-stone-400" }, "Manage your Grand Exchange flips from buy offer to completed sale."),
      createElement("p", { className: "mt-3 text-xs text-stone-500" }, "Risk profile: " + String(settings.risk_tolerance).toLowerCase())
    ),
    createElement("section", { className: "grid gap-3 sm:grid-cols-2 xl:grid-cols-4" },
      cards.map(([label, value, Icon]) => createElement("article", { key: label, className: "rounded-2xl border border-stone-800 bg-[#141a17] p-4" },
        createElement("div", { className: "flex items-center gap-2 text-xs text-stone-500" }, createElement(Icon, { size: 15 }), label),
        createElement("p", { className: "mt-2 text-lg font-semibold" }, value)
      ))
    ),
    createElement("section", { className: "rounded-3xl border border-stone-800 bg-[#141a17] p-5" },
      createElement("h2", { className: "text-xl font-semibold" }, "Grand Exchange slots"),
      createElement("div", { className: "mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" },
        Array.from({ length: slotCapacity }, (_, index) => createElement("article", { key: index, className: "min-h-28 rounded-2xl border border-dashed border-stone-700 bg-stone-950/40 p-4" },
          createElement("p", { className: "text-xs text-stone-500" }, "GE slot " + String(index + 1)),
          createElement("p", { className: "mt-6 text-sm text-stone-500" }, "Available")
        ))
      )
    )
  );
}
