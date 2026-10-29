"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { useInbox } from "@/lib/client/inbox";
import { askFinn } from "./copilot/Copilot";

/** Ask FINN: labelled, on every screen, never covering content. */
function AskButton() {
  return (
    <button onClick={() => askFinn()} className="flex h-9 items-center gap-1.5 rounded-full bg-brand px-3.5 text-[13px] font-bold text-brand-ink active:scale-95" aria-label="Ask FINN by voice">
      <Icon name="mic" size={16} />
      Ask
    </button>
  );
}

function Bell() {
  const { unread } = useInbox();
  return (
    <Link href="/inbox" className="relative grid h-9 w-9 place-items-center rounded-full bg-raise text-ink" aria-label={unread ? `Inbox, ${unread} new` : "Inbox"}>
      <Icon name="bell" size={18} />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-down px-1 text-[10px] font-extrabold text-white num">{unread > 9 ? "9+" : unread}</span>
      )}
    </Link>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const ds = document.documentElement.dataset.theme;
    setDark(ds ? ds === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  const flip = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("finn.theme", next ? "dark" : "light");
    } catch {
      /* storage unavailable: theme lasts for this visit */
    }
  };
  return (
    <button onClick={flip} className="grid h-9 w-9 place-items-center rounded-full bg-raise text-ink" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
      <Icon name={dark ? "sun" : "moon"} size={18} />
    </button>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="FINN home">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        {/* Fixed colours: the mark looks the same in light and dark mode, and matches the app icon. */}
        <rect width="32" height="32" rx="9" fill="#00707A" />
        <path d="M10 23V9h11M10 16h8" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <circle cx="23" cy="22" r="2.6" fill="#009662" />
      </svg>
      <span className="text-[17px] font-extrabold tracking-tight">FINN</span>
    </Link>
  );
}

export function AppHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="flex items-center justify-between px-4 pt-[max(14px,env(safe-area-inset-top))] pb-2">
      <Logo />
      <div className="flex items-center gap-2">
        {right}
        <AskButton />
        <Bell />
        <ThemeToggle />
      </div>
    </header>
  );
}
