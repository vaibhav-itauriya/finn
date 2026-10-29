"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Icon, type IconName } from "./Icon";

// Five labelled places, always in the same spot. Ask FINN lives in the header of every screen.
const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/digest", label: "Digest", icon: "inbox" },
  { href: "/portfolio", label: "Portfolio", icon: "pie" },
  { href: "/research", label: "Research", icon: "lens" },
  { href: "/alerts", label: "Alerts", icon: "dial" },
];

export function TabBar() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed bottom-0 inset-x-0 z-30 border-t border-rule bg-sheet/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto grid max-w-[520px] grid-cols-5">
        {TABS.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href) || (t.href === "/alerts" && (path.startsWith("/rules") || path.startsWith("/inbox")));
          return (
            <Link
              key={t.href}
              href={t.href}
              className={clsx("relative flex flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-semibold", active ? "text-brand" : "text-dim")}
              aria-current={active ? "page" : undefined}
            >
              {active && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-brand" aria-hidden />}
              <Icon name={t.icon} size={22} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
