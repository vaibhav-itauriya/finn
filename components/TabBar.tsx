"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Icon, type IconName } from "./Icon";
import { askFinn } from "./copilot/Copilot";

// Four places and one action. Ask FINN sits in the middle, so it never covers a card.
// Alerts live behind the bell (Inbox) and the Thresholds key on Home.
const LEFT: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/digest", label: "Digest", icon: "inbox" },
];
const RIGHT: { href: string; label: string; icon: IconName }[] = [
  { href: "/portfolio", label: "Portfolio", icon: "pie" },
  { href: "/research", label: "Research", icon: "lens" },
];

export function TabBar() {
  const path = usePathname();
  const tab = (t: { href: string; label: string; icon: IconName }) => {
    const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
    return (
      <Link
        key={t.href}
        href={t.href}
        className={clsx("relative flex flex-col items-center gap-1 pt-2.5 pb-2 text-[10.5px] font-semibold", active ? "text-brand" : "text-dim")}
        aria-current={active ? "page" : undefined}
      >
        {active && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-brand" aria-hidden />}
        <Icon name={t.icon} size={22} />
        {t.label}
      </Link>
    );
  };
  return (
    <nav aria-label="Main" className="fixed bottom-0 inset-x-0 z-30 border-t border-rule bg-sheet/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto grid max-w-[520px] grid-cols-5">
        {LEFT.map(tab)}
        <button onClick={() => askFinn()} className="flex flex-col items-center gap-1 pb-2 text-[10.5px] font-bold text-brand" aria-label="Ask FINN by voice">
          <span className="-mt-4 grid h-12 w-12 place-items-center rounded-full bg-brand text-brand-ink shadow-[0_6px_18px_-4px_rgb(var(--brand)/0.55)] ring-4 ring-paper active:scale-95">
            <Icon name="mic" size={22} />
          </span>
          Ask
        </button>
        {RIGHT.map(tab)}
      </div>
    </nav>
  );
}
