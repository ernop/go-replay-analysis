"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE_MODE } from "@/lib/site-mode";
import { cn } from "@/lib/utils";

// Accounts drive game fetching, which only the owner's LAN app does.
const TABS =
  SITE_MODE === "lan"
    ? [
        { href: "/", label: "Library" },
        { href: "/accounts", label: "Accounts" },
      ]
    : [{ href: "/", label: "Library" }];

export function Nav() {
  const pathname = usePathname();
  return (
    // Its height (h-7 plus the border) is part of the replayer's 45px allowance.
    <header className="w-full border-b border-[#1c1c1c]">
      <div className="fs-caption flex h-7 items-center gap-4 px-2 sm:px-4 md:px-6">
        <Link href="/" className="whitespace-nowrap font-bold text-gold">
          Go Game Replay
        </Link>
        <nav className="flex items-center gap-1">
          {TABS.map((tab) => {
            const active =
              tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn("rounded px-2 py-0.5", active ? "text-gold" : "text-foreground hover:bg-accent")}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
