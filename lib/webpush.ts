// Phone notifications through the browser's Web Push service (Android Chrome, desktop browsers,
// iPhone once FINN is added to the Home Screen). The VAPID key pair that signs our pushes is
// created on first use and kept in the shared store, so there's nothing to configure.
import { createHash } from "node:crypto";
import webpush from "web-push";
import { kv, kvEnabled } from "./kv";

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

let keys: { publicKey: string; privateKey: string } | null = null;

export async function vapid(): Promise<{ publicKey: string; privateKey: string } | null> {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    if (!kvEnabled()) return null;
    let raw = await kv<string>("GET", "finn:vapid");
    if (!raw) {
      // NX: if two instances race, both end up with the first pair written.
      await kv("SET", "finn:vapid", JSON.stringify(webpush.generateVAPIDKeys()), "NX");
      raw = await kv<string>("GET", "finn:vapid");
    }
    keys = raw ? JSON.parse(raw) : null;
  }
  if (keys) webpush.setVapidDetails("mailto:finn-alerts@users.noreply.github.com", keys.publicKey, keys.privateKey);
  return keys;
}

export const subId = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 20);

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

/** Returns false when the subscription is gone for good (uninstalled, permission revoked). */
export async function sendPush(sub: PushSub, p: PushPayload): Promise<boolean> {
  if (!(await vapid())) throw new Error("push not configured");
  try {
    await webpush.sendNotification(sub, JSON.stringify(p), { TTL: 6 * 3600, urgency: "high" });
    return true;
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) return false;
    throw e;
  }
}
