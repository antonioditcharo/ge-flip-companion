import { Save, Settings } from "lucide-react";
import { sql } from "@/lib/db";
import { updateSettings } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  saved?: string;
  error?: string;
}>;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const rows = await sql`
    select
      display_name,
      account_mode,
      cash_stack,
      risk_tolerance,
      minimum_profit,
      minimum_roi,
      maximum_capital_percent
    from app_settings
    where id = 1
    limit 1
  `;

  const settings = rows[0];
  if (!settings) throw new Error("Application settings were not found.");

  const minimumRoiPercent = Number(settings.minimum_roi) * 100;
  const fieldClass = "mt-1 w-full rounded-xl border border-stone-700 bg-stone-950 px-3 py-2.5 text-stone-100 outline-none focus:border-amber-400";
  const labelClass = "text-sm font-medium text-stone-300";

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-stone-800 bg-[#141a17] p-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300">
          <Settings size={24} aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-3xl font-bold">Settings</h1>
        <p className="mt-2 max-w-2xl text-sm text-stone-400">
          Configure account restrictions, available capital, risk preferences, and recommendation thresholds.
        </p>
      </section>

      {params.saved === "1" && (
        <p role="status" className="rounded-2xl border border-emerald-800/50 bg-emerald-950/30 p-4 text-sm text-emerald-200">
          Settings saved. The dashboard now uses your updated profile.
        </p>
      )}

      {params.error === "invalid" && (
        <p role="alert" className="rounded-2xl border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-200">
          One or more values were invalid. Check the limits shown below and try again.
        </p>
      )}

      <form action={updateSettings} className="rounded-3xl border border-stone-800 bg-[#141a17] p-6">
        <div className="grid gap-5 md:grid-cols-2">
          <label>
            <span className={labelClass}>Display name</span>
            <input className={fieldClass} name="displayName" required maxLength={50} defaultValue={String(settings.display_name)} />
          </label>

          <label>
            <span className={labelClass}>Account mode</span>
            <select className={fieldClass} name="accountMode" defaultValue={String(settings.account_mode)}>
              <option value="F2P">Free-to-play, 3 GE slots</option>
              <option value="P2P">Pay-to-play, 8 GE slots</option>
            </select>
          </label>

          <label>
            <span className={labelClass}>Cash stack in GP</span>
            <input className={fieldClass} name="cashStack" type="number" inputMode="numeric" required min="0" step="1" defaultValue={String(settings.cash_stack)} />
          </label>

          <label>
            <span className={labelClass}>Risk tolerance</span>
            <select className={fieldClass} name="riskTolerance" defaultValue={String(settings.risk_tolerance)}>
              <option value="CONSERVATIVE">Conservative</option>
              <option value="BALANCED">Balanced</option>
              <option value="AGGRESSIVE">Aggressive</option>
            </select>
          </label>

          <label>
            <span className={labelClass}>Minimum profit per trade in GP</span>
            <input className={fieldClass} name="minimumProfit" type="number" inputMode="numeric" required min="0" step="1" defaultValue={String(settings.minimum_profit)} />
          </label>

          <label>
            <span className={labelClass}>Minimum ROI percent</span>
            <input className={fieldClass} name="minimumRoiPercent" type="number" required min="0" max="1000" step="0.01" defaultValue={String(minimumRoiPercent)} />
          </label>

          <label>
            <span className={labelClass}>Maximum capital per trade percent</span>
            <input className={fieldClass} name="maximumCapitalPercent" type="number" required min="0.01" max="100" step="0.01" defaultValue={String(settings.maximum_capital_percent)} />
          </label>
        </div>

        <div className="mt-6 border-t border-stone-800 pt-5">
          <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-3 font-semibold text-stone-950 hover:bg-amber-300">
            <Save size={17} aria-hidden="true" />
            Save settings
          </button>
        </div>
      </form>

      <section className="rounded-2xl border border-amber-900/40 bg-amber-950/20 p-4 text-sm text-amber-100">
        Switching to F2P immediately reduces displayed capacity to three slots. Before switching, close or cancel any active trades assigned to slots 4 through 8.
      </section>
    </div>
  );
}
