// Real push: after each pipeline run, send what newly crossed the line.
//  1. The owner's chat (TELEGRAM_CHAT_ID secret): items at default thresholds, deduped via data/sent.json.
//  2. Every tester who connected Telegram in the app: the pipeline hands all candidate items to the
//     app's /api/telegram/broadcast, which applies each tester's own thresholds and mutes.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Digest } from "../types";
import { DEFAULT_RULES, moveAlerts } from "../client/alerts";
import { bundle } from "../client/bundle";
import { filingMessage, moveMessage, type PushItem } from "../telegram/format";
import { pushSecret } from "../telegram/secret";

const SENT = path.join(process.cwd(), "data", "sent.json");

function candidates(d: Digest, appUrl: string): PushItem[] {
  const since = Date.now() - 36 * 3600e3; // never push stale news
  const out: PushItem[] = [];
  for (const b of bundle(d.filings)) {
    const f = b.lead;
    if (new Date(f.ts).getTime() < since || f.tier === "routine") continue;
    const id = `f:${[f.id, ...b.related.map((r) => r.id)].sort()[0]}`;
    out.push({ id, kind: "filing", ticker: f.ticker, category: f.category, tier: f.tier, score: f.score, html: filingMessage(f, appUrl) });
  }
  // Loose thresholds here; each recipient's own thresholds are applied downstream.
  const day = new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10);
  for (const m of moveAlerts(d.prices, { ...DEFAULT_RULES, moveAbs: 2, volMultiple: 1.5 }, day)) {
    out.push({ id: `m:${m.ticker}:${m.d}`, kind: "move", ticker: m.ticker, change: m.change, volX: m.volX, html: moveMessage(m, appUrl) });
  }
  return out;
}

export async function notify(d: Digest, log: (s: string) => void) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  const appUrl = (process.env.FINN_APP_URL || "").replace(/\/$/, "");
  const items = candidates(d, appUrl);

  // 1. owner
  if (token && chat) {
    let sent: string[] = [];
    try {
      sent = JSON.parse(await fs.readFile(SENT, "utf8"));
    } catch {
      /* first run */
    }
    const seen = new Set(sent);
    const mine = items.filter(
      (it) =>
        !seen.has(it.id) &&
        (it.kind === "move"
          ? Math.abs(it.change ?? 0) >= DEFAULT_RULES.moveAbs || (it.volX ?? 0) >= DEFAULT_RULES.volMultiple
          : it.tier === "material" || (it.category && DEFAULT_RULES.pushCategories.includes(it.category) && (it.score ?? 0) >= 45)),
    );
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

  // 2. testers
  const secret = pushSecret();
  if (appUrl && secret && items.length) {
    try {
      const r = await fetch(`${appUrl}/api/telegram/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-finn-secret": secret },
        body: JSON.stringify({ items, skip: chat ? [chat] : [] }),
      });
      log(`telegram testers: ${r.status} ${(await r.text()).slice(0, 160)}`);
    } catch (e) {
      log(`telegram testers failed: ${(e as Error).message}`);
    }
  }
}
