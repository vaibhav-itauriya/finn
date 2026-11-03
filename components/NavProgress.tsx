"use client";
// A thin bar at the top that starts the moment you tap any link, tab or "open" button, and
// finishes when the next screen is on. On a slow phone the tap is acknowledged instantly
// instead of looking like nothing happened.
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export const startNav = () => window.dispatchEvent(new Event("finn-nav-start"));

export function NavProgress() {
  const path = usePathname();
  const search = useSearchParams();
  const [p, setP] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const finish = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setP((x) => (x == null ? null : 100));
    setTimeout(() => setP(null), 250);
  };

  useEffect(() => {
    const start = () => {
      if (timer.current) return;
      setP(8);
      // Creep towards 90% so it always looks alive; the real finish snaps it to 100.
      timer.current = setInterval(() => setP((x) => (x == null ? null : Math.min(90, x + (90 - x) * 0.08))), 120);
      setTimeout(() => timer.current && finish(), 15000); // never spin forever
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as HTMLElement).closest("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      start();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("finn-nav-start", start);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("finn-nav-start", start);
    };
  }, []);

  useEffect(() => {
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, search]);

  if (p == null) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]" role="progressbar" aria-label="Loading">
      <div className="h-full rounded-r-full bg-brand shadow-[0_0_8px_rgb(var(--brand)/0.7)] transition-[width] duration-200 ease-out" style={{ width: `${p}%` }} />
    </div>
  );
}
