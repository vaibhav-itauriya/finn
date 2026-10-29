"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import clsx from "clsx";
import { AppHeader } from "../AppHeader";
import { Icon } from "../Icon";
import { useInbox } from "@/lib/client/inbox";
import { relTime } from "@/lib/client/format";
import type { FeedItem } from "@/lib/feed";
import { PhonePushCard } from "./PhonePushCard";
import { TelegramBanner } from "../telegram/TelegramBanner";

const dayOf = (ts: string) => new Date(new Date(ts).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

export function InboxView() {
  const { items, seen, markSeen } = useInbox();
  // Remember what was unread when the screen opened, then mark everything read.
  const seenAtOpen = useRef<string | null>(null);
  useEffect(() => {
    if (items && seenAtOpen.current === null) {
      seenAtOpen.current = seen;
      markSeen();
    }
  }, [items, seen, markSeen]);
  const before = seenAtOpen.current ?? seen;

  const today = dayOf(new Date().toISOString());
  const groups: { label: string; items: FeedItem[] }[] = [];
  for (const it of items || []) {
    const d = dayOf(it.ts);
    const label = d === today ? "Today" : d === dayOf(new Date(Date.now() - 86400e3).toISOString()) ? "Yesterday" : new Date(d).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(it);
    else groups.push({ label, items: [it] });
  }

  return (
    <main>
      <AppHeader />
      <header className="px-4 pt-2">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">Inbox</h1>
        <p className="mt-1 text-[13px] leading-snug text-dim">
          Everything from the last 7 days that crossed{" "}
          <Link href="/alerts" className="font-semibold text-brand">
            your thresholds
          </Link>
          . The same items go to your phone and Telegram when those are on.
        </p>
      </header>

      {items === null ? (
        <div className="card mx-4 mt-4 h-40 animate-pulse" />
      ) : items.length === 0 ? (
        <section className="card mx-4 mt-4 p-4 text-[13px] text-dim">Nothing crossed your thresholds this week. Loosen them in Alerts to hear about more.</section>
      ) : (
        groups.map((g) => (
          <section key={g.label} className="mt-4">
            <h2 className="mx-4 text-[12px] font-bold uppercase tracking-wide text-dim">{g.label}</h2>
            <ul className="card mx-4 mt-2 divide-y divide-rule overflow-hidden">
              {g.items.map((it) => (
                <li key={it.id}>
                  <Link href={it.path} className="flex gap-3 px-3.5 py-3 active:bg-raise">
                    <span
                      className={clsx(
                        "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full",
                        it.kind === "move" ? ((it.change ?? 0) >= 0 ? "bg-up/15 text-up" : "bg-down/15 text-down") : it.tier === "material" ? "bg-brand-soft text-brand" : "bg-raise text-dim",
                      )}
                    >
                      <Icon name={it.kind === "move" ? "bolt" : it.kind === "digest" ? "inbox" : "doc"} size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13.5px] font-bold">{it.title}</span>
                        <span className="shrink-0 text-[11px] text-dim">{it.kind === "move" ? "at close" : relTime(it.ts)}</span>
                      </p>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-dim line-clamp-2">{it.body}</p>
                    </div>
                    {it.ts > before && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="New" />}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <h2 className="mx-4 mt-6 text-[13px] font-bold text-dim">Get these without opening the app</h2>
      <PhonePushCard compact />
      <TelegramBanner compact />
    </main>
  );
}
