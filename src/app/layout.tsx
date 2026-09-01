import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Activity } from "lucide-react";

import { SidebarNavigation } from "@/components/sidebar-navigation";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "GE Flip Companion",
    template: "%s | GE Flip Companion",
  },
  description:
    "An Old School RuneScape Grand Exchange flipping companion.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen bg-[#0d1110] text-stone-100">
          <header className="border-b border-amber-900/40 bg-[#121815]">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
                  <Activity
                    size={22}
                    aria-hidden="true"
                  />
                </div>

                <div>
                  <p className="text-lg font-bold text-amber-300">
                    GE Flip Companion
                  </p>

                  <p className="text-xs text-stone-400">
                    Decision support, not guaranteed profit
                  </p>
                </div>
              </div>

              <div className="hidden rounded-xl border border-emerald-800/40 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-300 sm:block">
                Database connected
              </div>
            </div>
          </header>

          <div className="mx-auto grid max-w-7xl gap-5 p-5 lg:grid-cols-[220px_1fr]">
            <SidebarNavigation />

            <main>{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
