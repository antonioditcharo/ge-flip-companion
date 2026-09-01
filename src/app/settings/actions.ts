"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sql } from "@/lib/db";

const settingsSchema = z.object({
  displayName: z.string().trim().min(1).max(50),
  accountMode: z.enum(["F2P", "P2P"]),
  cashStack: z.coerce.number().int().min(0).max(9_000_000_000_000_000),
  riskTolerance: z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]),
  minimumProfit: z.coerce.number().int().min(0).max(9_000_000_000_000_000),
  minimumRoiPercent: z.coerce.number().min(0).max(1000),
  maximumCapitalPercent: z.coerce.number().gt(0).max(100),
});

export async function updateSettings(formData: FormData) {
  const result = settingsSchema.safeParse({
    displayName: formData.get("displayName"),
    accountMode: formData.get("accountMode"),
    cashStack: formData.get("cashStack"),
    riskTolerance: formData.get("riskTolerance"),
    minimumProfit: formData.get("minimumProfit"),
    minimumRoiPercent: formData.get("minimumRoiPercent"),
    maximumCapitalPercent: formData.get("maximumCapitalPercent"),
  });

  if (!result.success) {
    redirect("/settings?error=invalid");
  }

  const values = result.data;
  const minimumRoiDecimal = values.minimumRoiPercent / 100;

  await sql`
    update app_settings
    set
      display_name = ${values.displayName},
      account_mode = ${values.accountMode},
      cash_stack = ${values.cashStack},
      risk_tolerance = ${values.riskTolerance},
      minimum_profit = ${values.minimumProfit},
      minimum_roi = ${minimumRoiDecimal},
      maximum_capital_percent = ${values.maximumCapitalPercent},
      updated_at = now()
    where id = 1
  `;

  revalidatePath("/");
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}
