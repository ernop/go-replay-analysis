"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Library" },
  { href: "/accounts", label: "Accounts" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="w-full border-b border-border bg-card">
      <div className="flex items-center gap-6 px-4 md:px-6 h-14">
        <Link href="/" className="text-xl font-bold tracking-wide text-gold">
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
                className={cn(
                  "px-3 py-1.5 rounded text-base font-semibold",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-accent"
                )}
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
