// Real push: after each pipeline run, send what newly crossed the line.
//  1. The owner's chat (TELEGRAM_CHAT_ID secret): items at default thresholds, deduped via data/sent.json.
//  2. Everyone who connected in the app (Telegram or phone notifications): the pipeline hands all
//     candidate items to the app's /api/telegram/broadcast, which applies each person's own
//     thresholds and mutes and never sends the same item twice.
// After market close it also adds the evening wrap, once a day.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Digest } from "../types";
import { DEFAULT_RULES, moveAlerts } from "../client/alerts";
import { candidates, dailyWrap, wants, type FeedItem } from "../feed";
import { digestMessage, filingMessage, moveMessage, type PushItem } from "../telegram/format";
import { pushSecret } from "../telegram/secret";
import { esc } from "../telegram/format";

const SENT = path.join(process.cwd(), "data", "sent.json");

function items(d: Digest, appUrl: string): PushItem[] {
  const since = Date.now() - 36 * 3600e3; // never push stale news
  const out: PushItem[] = [];
  const byId = new Map(d.filings.map((f) => [f.id, f]));
  for (const it of candidates(d, 3)) {
    if (new Date(it.ts).getTime() < since && it.kind === "filing") continue;
    if (it.kind === "filing") {
      const lead = it.ref ? byId.get(it.ref) : undefined;
      if (!lead) continue;
      out.push({ ...it, html: filingMessage(lead, appUrl) });
    } else {
      const m = moveAlerts(d.prices, { ...DEFAULT_RULES, moveAbs: 0, volMultiple: 0 }, it.ts.slice(0, 10)).find((x) => `m:${x.ticker}:${x.d}` === it.id);
      if (!m) continue;
      const kinds: ("price" | "volume")[] = [];
      if (Math.abs(m.change) >= 2) kinds.push("price");
      if (m.volX >= 1.5) kinds.push("volume");
      out.push({ ...it, html: moveMessage({ ...m, kinds }, appUrl) });
    }
  }
  // Evening wrap: the first run after 15:45 IST each day.
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (mins >= 15 * 60 + 45 && ist.getUTCDay() >= 1 && ist.getUTCDay() <= 5) {
    const w = dailyWrap(d);
    const wrap: FeedItem = { id: `d:${ist.toISOString().slice(0, 10)}`, kind: "digest", ticker: "", ts: new Date().toISOString(), title: w.title, body: w.lines.slice(0, 3).join(" · "), path: "/digest?w=24h" };
    out.push({ ...wrap, html: digestMessage(w.title, w.lines.map(esc), appUrl) });
  }
  return out;
}

export async function notify(d: Digest, log: (s: string) => void) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  const appUrl = (process.env.FINN_APP_URL || "").replace(/\/$/, "");
  const all = items(d, appUrl);

  // 1. owner
  if (token && chat) {
    let sent: string[] = [];
    try {
      sent = JSON.parse(await fs.readFile(SENT, "utf8"));
    } catch {
      /* first run */
    }
    const seen = new Set(sent);
    const mine = all.filter((it) => !seen.has(it.id) && wants(it, DEFAULT_RULES));
    for (const m of mine.slice(0, 12)) {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: m.html, parse_mode: "HTML", disable_web_page_preview: true }),
      });
      if (!r.ok) log(`telegram: ${r.status} ${(await r.text()).slice(0, 120)}`);
    }
    await fs.writeFile(SENT, JSON.stringify([...sent, ...mine.map((m) => m.id)].slice(-2000)));
    log(`telegram owner: sent ${Math.min(12, mine.length)}`);
  }

  // 2. testers (Telegram and phone notifications)
  const secret = pushSecret();
  if (appUrl && secret && all.length) {
    try {
      const r = await fetch(`${appUrl}/api/telegram/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-finn-secret": secret },
        body: JSON.stringify({ items: all, skip: chat ? [chat] : [] }),
      });
      log(`push testers: ${r.status} ${(await r.text()).slice(0, 160)}`);
    } catch (e) {
      log(`push testers failed: ${(e as Error).message}`);
    }
  }
}
