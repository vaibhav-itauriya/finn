// Real push: after each pipeline run, send what newly crossed the line to the investor's phone
// via a Telegram bot (free, no app-store review, works on every phone). Optional: runs only when
// TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set. Already-sent items are remembered in
// data/sent.json so nobody gets the same alert twice.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Digest, Filing } from "../types";
import { DEFAULT_RULES, moveAlerts } from "../client/alerts";
import { bundle } from "../client/bundle";
import { CATEGORY_LABEL } from "./classify";

const SENT = path.join(process.cwd(), "data", "sent.json");

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

function line(f: Filing, appUrl: string): string {
  const e = f.enrichment;
  let body = esc(f.title);
  if (e?.kind === "results") body = `${esc(e.period)}: ${esc(e.verdict)}`;
  else if (e?.kind === "management") {
    const p = e.people[0];
    body = `${esc(p.name)}, ${esc(p.role)} (${p.change})${p.bio ? `\n<i>${esc(p.bio)}</i>` : ""}`;
  } else if (e?.kind === "summary") body = esc(e.line);
  return `<b>${f.ticker}</b> · ${CATEGORY_LABEL[f.category]}\n${body}\n<a href="${appUrl}/research/${f.ticker}">Research</a>${f.pdf ? ` · <a href="${f.pdf}">Filing</a>` : ""}`;
}

export async function notify(d: Digest, log: (s: string) => void) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  const appUrl = (process.env.FINN_APP_URL || "").replace(/\/$/, "");
  if (!token || !chat) return;
  let sent: string[] = [];
  try {
    sent = JSON.parse(await fs.readFile(SENT, "utf8"));
  } catch {
    /* first run */
  }
  const seen = new Set(sent);
  const firstRun = sent.length === 0;
  const since = Date.now() - 36 * 3600e3; // never push stale news

  const msgs: { id: string; text: string }[] = [];
  for (const b of bundle(d.filings)) {
    const f = b.lead;
    if (f.tier !== "material" || new Date(f.ts).getTime() < since) continue;
    const id = `f:${[f.id, ...b.related.map((r) => r.id)].sort()[0]}`;
    if (seen.has(id)) continue;
    msgs.push({ id, text: line(f, appUrl) });
  }
  const today = new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10);
  for (const m of moveAlerts(d.prices, DEFAULT_RULES, today)) {
    const id = `m:${m.ticker}:${m.d}`;
    if (seen.has(id)) continue;
    const bits = [];
    if (m.kinds.includes("price")) bits.push(`${m.change > 0 ? "+" : ""}${m.change.toFixed(1)}% on the day`);
    if (m.kinds.includes("volume")) bits.push(`volume ${m.volX.toFixed(1)}× its 20-day average`);
    msgs.push({ id, text: `<b>${m.ticker}</b> · Unusual move\nClosed ₹${m.close.toLocaleString("en-IN")}, ${bits.join(", ")}\n<a href="${appUrl}/research/${m.ticker}">Research</a>` });
  }
  if (!msgs.length) return log("telegram: nothing new");

  // On the very first run, mark the backlog as seen and send a single summary instead of a flood.
  const toSend = firstRun ? [{ id: "intro", text: `<b>FINN is watching ${d.portfolio.length} holdings.</b>\n${msgs.length} items in the last 36 hours are waiting in <a href="${appUrl || "https://"}">Today</a>. From now on you'll get each new one here.` }] : msgs.slice(0, 12);
  for (const m of toSend) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: m.text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) log(`telegram: ${r.status} ${(await r.text()).slice(0, 120)}`);
  }
  await fs.writeFile(SENT, JSON.stringify([...sent, ...msgs.map((m) => m.id)].slice(-2000)));
  log(`telegram: sent ${toSend.length}`);
}
