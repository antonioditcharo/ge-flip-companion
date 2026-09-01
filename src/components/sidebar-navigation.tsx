"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, Bell, History, LayoutDashboard, Search, Settings } from "lucide-react";

const navigation = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trade-finder", label: "Trade Finder", icon: Search },
  { href: "/trades", label: "Active Trades", icon: Activity },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/history", label: "History", icon: History },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarNavigation() {
  const pathname = usePathname();

  return (
    <aside className="h-fit rounded-2xl border border-stone-800 bg-[#141a17] p-3 shadow-xl">
      <nav aria-label="Main navigation" className="space-y-1">
        {navigation.map((entry) => {
          const Icon = entry.icon;
          const isActive = entry.href === "/" ? pathname === "/" : pathname.startsWith(entry.href);

          return (
            <Link
              key={entry.href}
              href={entry.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${
                isActive
                  ? "bg-amber-400/10 text-amber-300"
                  : "text-stone-400 hover:bg-stone-800 hover:text-stone-100"
              }`}
            >
              <Icon size={17} aria-hidden="true" />
              {entry.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
