"use client";
// Phone notifications through Web Push. The subscription is stored server-side together with this
// browser's thresholds; the "on" state is read from the browser itself, so nothing else is kept.
import { useCallback, useEffect, useState } from "react";
import type { Rules } from "./alerts";

type State = "unsupported" | "needs-install" | "off" | "on" | "denied" | "busy";

const rulesNow = (): Rules | null => {
  try {
    return JSON.parse(localStorage.getItem("finn.rules") || "null");
  } catch {
    return null;
  }
};

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

function b64ToBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSub() {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

export function usePhonePush() {
  const [state, setState] = useState<State>("busy");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState(isIOS() && !standalone() ? "needs-install" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") return setState("denied");
    setState((await currentSub()) ? "on" : "off");
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    setError(null);
    setState("busy");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
      const reg = await registerSW();
      if (!reg) throw new Error("This browser can't receive notifications");
      await navigator.serviceWorker.ready;
      const k = await fetch("/api/push/key").then((r) => r.json());
      if (!k.publicKey) throw new Error("Notifications aren't set up on the server yet");
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(k.publicKey) }));
      const r = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sub, rules: rulesNow() }) });
      if (!r.ok) throw new Error((await r.json()).error || "Couldn't save the subscription");
      await fetch("/api/push/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sub }) });
      setState("on");
    } catch (e) {
      setError((e as Error).message);
      refresh();
    }
  }, [refresh]);

  const disable = useCallback(async () => {
    setState("busy");
    const sub = await currentSub();
    if (sub) {
      await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sub, off: true }) }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    refresh();
  }, [refresh]);

  const test = useCallback(async () => {
    const sub = await currentSub();
    if (sub) await fetch("/api/push/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sub }) });
  }, []);

  return { state, error, enable, disable, test };
}

/** Keep this phone's push thresholds in step with the Alerts screen. */
export async function syncPushRules(rules: Rules) {
  try {
    const sub = await currentSub();
    if (sub) await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sub, rules }) });
  } catch {
    /* not subscribed */
  }
}
