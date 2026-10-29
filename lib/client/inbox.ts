"use client";
// The in-app inbox: the same items Telegram and phone notifications would carry, at this
// browser's thresholds. "Unread" is anything newer than the last time the inbox was opened.
import { useEffect, useMemo, useState } from "react";
import type { FeedItem } from "../feed";
import { wants } from "../feed";
import { useRules } from "./prefs";

let feedPromise: Promise<FeedItem[]> | null = null;
const loadFeed = () =>
  (feedPromise ??= fetch("/api/feed")
    .then((r) => r.json())
    .then((j) => j.items as FeedItem[])
    .catch(() => {
      feedPromise = null;
      return [];
    }));

const SEEN = "finn.inboxSeen";

export function useInbox() {
  const [rules, , ready] = useRules();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [seen, setSeen] = useState<string>("");
  useEffect(() => {
    loadFeed().then(setItems);
    try {
      setSeen(localStorage.getItem(SEEN) || "");
    } catch {
      /* private mode */
    }
    const on = () => {
      try {
        setSeen(localStorage.getItem(SEEN) || "");
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("finn-inbox", on);
    return () => window.removeEventListener("finn-inbox", on);
  }, []);
  const mine = useMemo(() => (items && ready ? items.filter((it) => wants(it, rules)) : null), [items, rules, ready]);
  const unread = mine ? mine.filter((it) => it.ts > seen).length : 0;
  const markSeen = () => {
    const now = new Date().toISOString();
    try {
      localStorage.setItem(SEEN, now);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event("finn-inbox"));
  };
  return { items: mine, unread, seen, markSeen };
}
