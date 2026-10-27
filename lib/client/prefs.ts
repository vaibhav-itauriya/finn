"use client";
// Per-viewer state (rules, cleared items, last visit). Lives in localStorage because it is
// personal convenience; every read/write is guarded so the app works in private mode too.
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_RULES, type Rules } from "./alerts";

function read<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v ? ({ ...fallback, ...JSON.parse(v) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, v: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable: keep in memory */
  }
}

export function useStored<T extends object>(key: string, fallback: T) {
  const [v, setV] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setV(read(key, fallback));
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback(
    (next: T | ((p: T) => T)) => {
      setV((p) => {
        const n = typeof next === "function" ? (next as (p: T) => T)(p) : next;
        write(key, n);
        return n;
      });
    },
    [key],
  );
  return [v, set, ready] as const;
}

export const useRules = () => useStored<Rules>("finn.rules", DEFAULT_RULES);
export const useCleared = () => useStored<{ ids: string[] }>("finn.cleared", { ids: [] });

/** Last visit time, read once per session so "since last visit" is stable while you work. */
export function useLastVisit(): string | null {
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    let prev: string | null = null;
    try {
      prev = window.sessionStorage.getItem("finn.sessionLast") || window.localStorage.getItem("finn.lastVisit");
      window.sessionStorage.setItem("finn.sessionLast", prev || "");
      window.localStorage.setItem("finn.lastVisit", new Date().toISOString());
    } catch {
      /* ignore */
    }
    setLast(prev || null);
  }, []);
  return last;
}
