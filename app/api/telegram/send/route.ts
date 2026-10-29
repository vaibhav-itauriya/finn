// "Send to Telegram" from the app. Only content FINN already has (a filing, a move, the digest)
// can be sent, never arbitrary text, and only to a chat that started the bot.
import { NextResponse } from "next/server";
import { loadDigest } from "@/lib/data";
import { send } from "@/lib/telegram/bot";
import { filingMessage, moveMessage } from "@/lib/telegram/format";
import { digestReply } from "@/lib/telegram/replies";
import { DEFAULT_RULES, moveAlerts, type Rules } from "@/lib/client/alerts";

export const dynamic = "force-dynamic";

const recent = new Map<string, number[]>();
function limited(chat: string) {
  const now = Date.now();
  const xs = (recent.get(chat) || []).filter((t) => now - t < 60_000);
  xs.push(now);
  recent.set(chat, xs);
  return xs.length > 8;
}

export async function POST(req: Request) {
  const appUrl = new URL(req.url).origin;
  const b = (await req.json().catch(() => ({}))) as { chatId?: string; kind?: string; id?: string; ticker?: string; d?: string; hours?: number; rules?: Rules };
  const chat = String(b.chatId || "");
  if (!/^-?\d{5,15}$/.test(chat)) return NextResponse.json({ error: "Connect Telegram first" }, { status: 400 });
  if (limited(chat)) return NextResponse.json({ error: "Slow down a little" }, { status: 429 });
  const d = await loadDigest(70);
  if (!d) return NextResponse.json({ error: "No data yet" }, { status: 503 });
  try {
    if (b.kind === "filing") {
      const f = d.filings.find((x) => x.id === b.id);
      if (!f) return NextResponse.json({ error: "Filing not found" }, { status: 404 });
      await send(chat, filingMessage(f, appUrl));
    } else if (b.kind === "move") {
      const rules = { ...DEFAULT_RULES, ...(b.rules || {}) };
      const m = moveAlerts(d.prices, { ...rules, moveAbs: 0, volMultiple: 0 }, b.d || "").find((x) => x.ticker === b.ticker && x.d === b.d);
      if (!m) return NextResponse.json({ error: "Move not found" }, { status: 404 });
      const kinds: ("price" | "volume")[] = [];
      if (Math.abs(m.change) >= rules.moveAbs) kinds.push("price");
      if (m.volX >= rules.volMultiple) kinds.push("volume");
      await send(chat, moveMessage({ ...m, kinds: kinds.length ? kinds : ["price"] }, appUrl));
    } else {
      // digest (also used as the test message)
      const r = digestReply(d, Math.min(720, Math.max(1, Number(b.hours) || 24)), appUrl);
      await send(chat, r.html, r.buttons);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: /chat not found|blocked/i.test(msg) ? "Open the bot in Telegram and press Start first" : msg }, { status: 502 });
  }
}
