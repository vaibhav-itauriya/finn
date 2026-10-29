// "Send to my FINN bot" from the app's Share sheet. Cards are rebuilt server-side from FINN's own
// data (a filing, a move, a holding, the digest, a research verdict), only to a chat that started
// the bot. The one exception is a research verdict computed live in the browser, which is sent
// as escaped plain text, capped in length, to the sender's own chat.
import { NextResponse } from "next/server";
import { loadDigest } from "@/lib/data";
import { send } from "@/lib/telegram/bot";
import { filingMessage, moveMessage } from "@/lib/telegram/format";
import { digestReply, researchReply } from "@/lib/telegram/replies";
import { esc } from "@/lib/telegram/format";
import { summarise } from "@/lib/client/portfolio";
import { filingLine } from "@/lib/feed";
import { CATEGORY_LABEL } from "@/lib/push/classify";
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
  const b = (await req.json().catch(() => ({}))) as { chatId?: string; kind?: string; id?: string; ticker?: string; d?: string; hours?: number; rules?: Rules; summary?: string };
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
    } else if (b.kind === "research") {
      const t = String(b.ticker || "").toUpperCase().replace(/[^A-Z0-9&-]/g, "");
      const r = await researchReply(t, appUrl);
      // A verdict computed live in the browser isn't in a snapshot: send the summary the user saw.
      const html = /kept \d+ of/.test(r.html) || !b.summary ? r.html : `<b>${esc(t)}</b> · promises vs delivery\n${esc(String(b.summary).slice(0, 1500))}`;
      await send(chat, html, r.buttons);
    } else if (b.kind === "holding") {
      const p = summarise(d).positions.find((x) => x.h.ticker === b.ticker);
      if (!p) return NextResponse.json({ error: "Holding not found" }, { status: 404 });
      const pct = (x: number | null) => (x == null ? "–" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`);
      const fs = d.filings.filter((f) => f.ticker === p.h.ticker && f.tier !== "routine").slice(0, 3);
      await send(
        chat,
        `<b>${esc(p.h.name)}</b> (${p.h.ticker})\n₹${p.ltp?.toLocaleString("en-IN")} · day ${pct(p.day)} · 1M ${pct(p.m1)} · 3M ${pct(p.m3)}\n${p.h.qty} shares, worth ₹${Math.round(p.value ?? 0).toLocaleString("en-IN")}\n${fs.map((f) => `• ${CATEGORY_LABEL[f.category]}: ${esc(filingLine(f).slice(0, 140))}`).join("\n")}`,
        [[{ text: `Open ${p.h.ticker}`, url: `${appUrl}/portfolio?h=${p.h.ticker}` }]],
      );
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
