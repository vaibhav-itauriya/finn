"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const TABS = [
  { href: "/", label: "Today", icon: InboxIcon },
  { href: "/research", label: "Research", icon: LensIcon },
  { href: "/rules", label: "Rules", icon: DialIcon },
];

export function TabBar() {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed bottom-0 inset-x-0 z-30 border-t border-rule bg-sheet/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto max-w-[520px] grid grid-cols-3">
        {TABS.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={clsx("flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium", active ? "text-ink" : "text-dim")}
              aria-current={active ? "page" : undefined}
            >
              <Icon active={active} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function InboxIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 13l2.5-7.5A2 2 0 017.4 4h9.2a2 2 0 011.9 1.5L21 13v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 13h5l1.5 2.5h5L16 13h5" stroke={active ? "rgb(var(--marigold))" : "currentColor"} strokeWidth="1.7" />
    </svg>
  );
}
function LensIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M15.5 15.5L21 21" stroke={active ? "rgb(var(--marigold))" : "currentColor"} strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
function DialIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="16" cy="7" r="2.2" stroke={active ? "rgb(var(--marigold))" : "currentColor"} strokeWidth="1.7" />
      <circle cx="10" cy="17" r="2.2" stroke={active ? "rgb(var(--marigold))" : "currentColor"} strokeWidth="1.7" />
    </svg>
  );
}
