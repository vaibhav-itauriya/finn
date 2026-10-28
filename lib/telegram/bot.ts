// Minimal Telegram Bot API client (server only).
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

export async function send(chatId: string | number, html: string) {
  return tg("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true });
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
