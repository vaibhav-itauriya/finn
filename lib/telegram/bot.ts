// Minimal Telegram Bot API client (server only).
import { createHash } from "node:crypto";
const token = () => process.env.TELEGRAM_BOT_TOKEN || "";

export const botEnabled = () => Boolean(token());

export async function tg<T = unknown>(method: string, body?: object): Promise<T> {
  const r = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const j = (await r.json()) as { ok: boolean; result: T; description?: string };
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description || r.status}`);
  return j.result;
}

let username: string | null = null;
export async function botUsername(): Promise<string | null> {
  if (username) return username;
  if (!botEnabled()) return null;
  const me = await tg<{ username: string }>("getMe");
  username = me.username;
  return username;
}

export type Button = { text: string; url: string };

export async function send(chatId: string | number, html: string, buttons?: Button[][]) {
  return tg("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(buttons?.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

/** Secret Telegram echoes back on every webhook call, so nobody else can post updates to us. */
export const webhookSecret = () => createHash("sha256").update(`finn-webhook|${token()}`).digest("hex").slice(0, 48);

export const COMMANDS = [
  { command: "digest", description: "What needs me in the last 24 hours" },
  { command: "portfolio", description: "Value, today's P&L and the movers" },
  { command: "moves", description: "Unusual price and volume moves this week" },
  { command: "research", description: "Promises vs delivery for a company, e.g. /research TITAN" },
  { command: "wrap", description: "The evening wrap" },
  { command: "settings", description: "Change thresholds or stop alerts" },
  { command: "stop", description: "Stop automatic alerts" },
];

/**
 * Point the bot at this deployment (production only), once. Webhook mode lets FINN answer
 * questions and voice notes; pairing then goes through the shared store instead of getUpdates.
 */
export async function ensureWebhook(origin: string): Promise<boolean> {
  const { kv, kvEnabled } = await import("../kv");
  if (!botEnabled() || !kvEnabled()) return false;
  const url = `${origin}/api/telegram/webhook`;
  if ((await kv<string>("GET", "finn:webhook")) === url) return true;
  const info = await tg<{ url: string }>("getWebhookInfo");
  if (info.url !== url) {
    await tg("setWebhook", { url, secret_token: webhookSecret(), allowed_updates: ["message"], max_connections: 20 });
  }
  await tg("setMyCommands", { commands: COMMANDS }).catch(() => {});
  await kv("SET", "finn:webhook", url, "EX", 86400);
  return true;
}

export async function fileBase64(fileId: string): Promise<string> {
  const f = await tg<{ file_path: string }>("getFile", { file_id: fileId });
  const r = await fetch(`https://api.telegram.org/file/bot${token()}/${f.file_path}`);
  return Buffer.from(await r.arrayBuffer()).toString("base64");
}

interface Update {
  update_id: number;
  message?: { text?: string; chat: { id: number; first_name?: string; username?: string } };
}

/**
 * Pairing without a database: the app opens t.me/<bot>?start=<code>, Telegram delivers
 * "/start <code>" to the bot, and we find it in the bot's pending updates. Updates are never
 * acknowledged here, so concurrent pairings don't steal each other's messages; Telegram drops
 * them after 24 hours on its own.
 */
export async function findStart(code: string): Promise<{ chatId: number; name: string } | null> {
  const ups = await tg<Update[]>("getUpdates", { limit: 100, timeout: 0, allowed_updates: ["message"] });
  for (const u of ups.reverse()) {
    const t = u.message?.text?.trim();
    if (t === `/start ${code}`) {
      const c = u.message!.chat;
      return { chatId: c.id, name: c.first_name || c.username || "there" };
    }
  }
  return null;
}
