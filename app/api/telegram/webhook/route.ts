// Telegram webhook: pairing, commands, free questions and voice notes. Replies are produced after
// the 200 is returned (Telegram retries slow webhooks), using the same copilot as the app.
import { NextResponse, after } from "next/server";
import { kv } from "@/lib/kv";
import { fileBase64, send, tg, webhookSecret } from "@/lib/telegram/bot";
import { loadDigest } from "@/lib/data";
import { DEFAULT_RULES, type Rules } from "@/lib/client/alerts";
import { ask, type Turn } from "@/lib/copilot";
import { HELP, digestReply, movesReply, portfolioReply, researchReply, wrapReply } from "@/lib/telegram/replies";
import { esc } from "@/lib/telegram/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Msg {
  text?: string;
  voice?: { file_id: string; duration: number; mime_type?: string };
  audio?: { file_id: string; duration: number; mime_type?: string };
  chat: { id: number; first_name?: string; username?: string };
}

const appUrl = (req: Request) => (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : new URL(req.url).origin);

async function subscribe(chat: string, name: string) {
  // Anyone who presses Start gets the scheduled alerts at the default thresholds; the app can
  // later overwrite them with that person's own.
  await kv("HSETNX", "finn:subs", chat, JSON.stringify({ name, rules: null, at: new Date().toISOString() }));
}

async function rulesOf(chat: string): Promise<Rules> {
  try {
    const raw = await kv<string>("HGET", "finn:subs", chat);
    return { ...DEFAULT_RULES, ...(raw ? JSON.parse(raw).rules || {} : {}) };
  } catch {
    return DEFAULT_RULES;
  }
}

async function handle(m: Msg, app: string) {
  const chat = String(m.chat.id);
  const name = m.chat.first_name || m.chat.username || "there";
  const text = (m.text || "").trim();
  const [cmd, ...args] = text.split(/\s+/);
  const c = cmd?.toLowerCase().replace(/@\w+$/, "");

  if (c === "/start") {
    await subscribe(chat, name);
    // Pairing from the app: hand the chat to the waiting browser through the store.
    if (args[0] && /^f[a-z0-9]{8,24}$/.test(args[0])) await kv("SET", `finn:claim:${args[0]}`, JSON.stringify({ chatId: chat, name }), "EX", 3600);
    return send(chat, HELP(name), [[{ text: "Open FINN", url: app }]]);
  }
  if (c === "/help") return send(chat, HELP(name));
  if (c === "/stop") {
    await kv("HDEL", "finn:subs", chat);
    return send(chat, "Automatic alerts are off. You can still ask me anything. Send /start to turn them back on.");
  }
  if (c === "/settings") return send(chat, "Set what counts as unusual, which filing types reach you and the evening wrap in the app.", [[{ text: "Open Alerts", url: `${app}/alerts` }]]);

  const d = await loadDigest(70);
  if (!d) return send(chat, "FINN has no data yet. Try again after the next run.");

  if (c === "/digest") {
    const h = /^(\d+)\s*d/.test(args[0] || "") ? Number(args[0].match(/\d+/)![0]) * 24 : /^(\d+)\s*h/.test(args[0] || "") ? Number(args[0].match(/\d+/)![0]) : 24;
    const r = digestReply(d, Math.min(720, Math.max(1, h)), app);
    return send(chat, r.html, r.buttons);
  }
  if (c === "/wrap") {
    const r = wrapReply(d, app);
    return send(chat, r.html, r.buttons);
  }
  if (c === "/portfolio") {
    const r = portfolioReply(d, app);
    return send(chat, r.html, r.buttons);
  }
  if (c === "/moves" || c === "/alerts") {
    const r = movesReply(d, await rulesOf(chat), app);
    return send(chat, r.html, r.buttons);
  }
  if (c === "/research") {
    if (!args[0]) return send(chat, "Which company? For example /research TITAN or /research ASIANPAINT.");
    const r = await researchReply(args[0], app);
    return send(chat, r.html, r.buttons);
  }

  // Anything else: a question, typed or spoken.
  const voice = m.voice || m.audio;
  if (!text && !voice) return send(chat, "Send me a question or a voice note.");
  if (voice && voice.duration > 90) return send(chat, "Keep voice notes under a minute and a half.");
  await tg("sendChatAction", { chat_id: chat, action: "typing" }).catch(() => {});
  const histKey = `finn:hist:${chat}`;
  const history = ((await kv<string[]>("LRANGE", histKey, 0, 5)) || []).reverse().map((x) => JSON.parse(x) as Turn);
  try {
    const r = await ask({
      q: text || undefined,
      audio: voice ? { data: await fileBase64(voice.file_id), mime: (voice.mime_type || "audio/ogg").split(";")[0] } : undefined,
      history,
      rules: await rulesOf(chat),
    });
    const heard = voice && r.heard ? `🎙 <i>${esc(r.heard)}</i>\n\n` : "";
    await send(chat, heard + esc(r.reply), r.path ? [[{ text: r.label || "Open in FINN", url: app + r.path }]] : undefined);
    await kv("LPUSH", histKey, JSON.stringify({ role: "user", text: r.heard || text }), JSON.stringify({ role: "finn", text: r.reply }));
    await kv("LTRIM", histKey, 0, 5);
    await kv("EXPIRE", histKey, 3 * 3600);
  } catch (e) {
    const msg = (e as Error).message;
    await send(chat, /quota|rate|available/i.test(msg) ? "My free model quota is busy right now. Try again in a minute, or use /digest and /portfolio, which don't need it." : "Sorry, I couldn't answer that one.");
  }
}

export async function POST(req: Request) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret()) return NextResponse.json({ ok: false }, { status: 403 });
  const u = (await req.json().catch(() => ({}))) as { message?: Msg };
  if (u.message?.chat?.id) {
    const app = appUrl(req);
    after(() => handle(u.message!, app).catch((e) => console.error("telegram webhook:", (e as Error).message)));
  }
  return NextResponse.json({ ok: true });
}
