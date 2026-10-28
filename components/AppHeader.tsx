"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";

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
        <rect width="32" height="32" rx="9" fill="rgb(var(--brand))" />
        <path d="M10 23V9h11M10 16h8" stroke="rgb(var(--brand-ink))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <circle cx="23" cy="22" r="2.6" fill="rgb(var(--up))" />
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
        <ThemeToggle />
      </div>
    </header>
  );
}
