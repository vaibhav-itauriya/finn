"use client";
// Connect-your-own-Telegram, no login: the app makes a one-time code, opens the bot with
// t.me/<bot>?start=<code>, and polls until the bot has seen "/start <code>". The chat ID then
// lives in this browser only.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Rules } from "./alerts";

export interface TgConn {
  chatId: string;
  name: string;
}

type Status = "idle" | "waiting" | "connected" | "error";

const KEY = "finn.tg";
const read = (): TgConn | null => {
  try {
    const v = localStorage.getItem(KEY);
    return v ? (JSON.parse(v) as TgConn) : null;
  } catch {
    return null;
  }
};

let cfgPromise: Promise<{ enabled: boolean; bot: string | null; scheduled: boolean }> | null = null;
const config = () => (cfgPromise ??= fetch("/api/telegram/config").then((r) => r.json()).catch(() => ({ enabled: false, bot: null, scheduled: false })));

export function useTelegram() {
  const [conn, setConn] = useState<TgConn | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [cfg, setCfg] = useState<{ enabled: boolean; bot: string | null; scheduled: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const c = read();
    if (c) {
      setConn(c);
      setStatus("connected");
    }
    config().then(setCfg);
    const onStore = () => {
      const c2 = read();
      setConn(c2);
      setStatus(c2 ? "connected" : "idle");
    };
    window.addEventListener("finn-tg", onStore);
    return () => {
      window.removeEventListener("finn-tg", onStore);
      if (poll.current) clearInterval(poll.current);
    };
  }, []);

  const connect = useCallback(async () => {
    const c = await config();
    if (!c.enabled || !c.bot) {
      setError("Telegram isn't configured on this deployment.");
      setStatus("error");
      return;
    }
    const code = "f" + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join("");
    const url = `https://t.me/${c.bot}?start=${code}`;
    setLink(url);
    window.open(url, "_blank", "noopener");
    setStatus("waiting");
    setError(null);
    const started = Date.now();
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(async () => {
      if (Date.now() - started > 3 * 60e3) {
        clearInterval(poll.current!);
        setStatus("error");
        setError("Didn't see you press Start. Try again.");
        return;
      }
      try {
        const r = await fetch(`/api/telegram/claim?code=${code}`).then((x) => x.json());
        if (r.status === "connected") {
          clearInterval(poll.current!);
          const v = { chatId: r.chatId, name: r.name };
          try {
            localStorage.setItem(KEY, JSON.stringify(v));
          } catch {
            /* keep in memory */
          }
          setConn(v);
          setStatus("connected");
          window.dispatchEvent(new Event("finn-tg"));
          // Register for scheduled pushes with this browser's thresholds (no-op without the store).
          let rules: Rules | null = null;
          try {
            rules = JSON.parse(localStorage.getItem("finn.rules") || "null");
          } catch {
            /* defaults */
          }
          fetch("/api/telegram/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: v.chatId, name: v.name, rules }) });
        }
      } catch {
        /* keep polling */
      }
    }, 2500);
  }, []);

  const disconnect = useCallback(() => {
    const c = read();
    if (c) fetch("/api/telegram/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: c.chatId, off: true }) });
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setConn(null);
    setStatus("idle");
    window.dispatchEvent(new Event("finn-tg"));
  }, []);

  const send = useCallback(
    async (body: Record<string, unknown>) => {
      const c = read();
      if (!c) throw new Error("Connect Telegram first");
      const r = await fetch("/api/telegram/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, chatId: c.chatId }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't send");
    },
    [],
  );

  return { conn, status, cfg, error, link, connect, disconnect, send };
}

/** Keep a connected tester's scheduled-push thresholds in sync with the Alerts screen. */
export function syncRules(rules: Rules) {
  import("./push").then((m) => m.syncPushRules(rules));
  const c = read();
  if (!c) return;
  fetch("/api/telegram/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: c.chatId, name: c.name, rules }) }).catch(() => {});
}
