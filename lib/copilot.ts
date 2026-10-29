// "Ask FINN": one copilot behind the in-app voice button and the Telegram chat. It answers only
// from what FINN itself has read (the portfolio's prices and filings, and research it prepared),
// replies in a form that sounds right read aloud, and can open the screen that answers the
// question. Speech in, text out: the browser or Telegram handles the audio.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Digest } from "./types";
import { loadDigest } from "./data";
import { summarise } from "./client/portfolio";
import { candidates, wants } from "./feed";
import { DEFAULT_RULES, moveAlerts, type Rules } from "./client/alerts";
import { llm, parseJSON, type Part } from "./llm/router";
import { searchCompanies } from "./sources/screener";
import { RESEARCH_DEMO } from "../config/portfolio";

export interface Turn {
  role: "user" | "finn";
  text: string;
}

export interface CopilotReply {
  heard?: string; // what we understood from a voice note
  reply: string;
  lang: string; // BCP-47, for the speech voice
  path: string | null; // screen to open, if any
  label?: string; // button text for that screen
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    heard: { type: "STRING", nullable: true, description: "Only for audio input: the user's words, transcribed verbatim" },
    reply: { type: "STRING", description: "The spoken answer, at most 70 words, plain sentences, no markdown or lists" },
    lang: { type: "STRING", enum: ["en-IN", "hi-IN"] },
    open: { type: "STRING", nullable: true, description: "App path to open, or null" },
    label: { type: "STRING", nullable: true, description: "2-4 word button label for that path" },
    company: { type: "STRING", nullable: true, description: "If the user named a company outside the data, its name as they said it" },
  },
  required: ["reply", "lang", "open"],
};

async function researchNotes(): Promise<string[]> {
  const dir = path.join(process.cwd(), "data", "research");
  const out: string[] = [];
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const r = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
      const l = r.ledger;
      const t = r.thesis;
      const bits = [`${r.ticker}:`];
      if (l) bits.push(`credibility ${l.credibility.score}/10 (${l.credibility.delivered} kept, ${l.credibility.missed} missed, ${l.credibility.pending} pending). ${l.credibility.line}`);
      if (l?.currentGuidance?.length) bits.push(`Guidance: ${l.currentGuidance.slice(0, 3).map((g: { statement: string }) => g.statement).join("; ")}`);
      if (t?.bull?.length) bits.push(`Bull: ${t.bull[0].point}`);
      if (t?.bear?.length) bits.push(`Bear: ${t.bear[0].point}`);
      out.push(bits.join(" "));
    } catch {
      /* skip */
    }
  }
  return out;
}

function context(d: Digest, rules: Rules, notes: string[]): string {
  const s = summarise(d);
  const cr = (x: number) => `₹${(x / 1e5).toFixed(2)} lakh`;
  const pos = [...s.positions]
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .map((p) => `${p.h.ticker} (${p.h.name}, ${p.h.sector}): ₹${p.ltp?.toLocaleString("en-IN")}, day ${p.day?.toFixed(2)}%, 1M ${p.m1?.toFixed(1)}%, weight ${s.value ? (((p.value ?? 0) / s.value) * 100).toFixed(1) : 0}%`);
  const feed = candidates(d, 7)
    .filter((it) => it.kind === "filing")
    .slice(0, 30)
    .map((it) => `${it.ts.slice(0, 10)} ${it.title}${wants(it, rules) ? " [ALERT]" : ""}: ${it.body}`);
  const last = d.prices.map((p) => p.bars.at(-1)?.d).filter(Boolean).sort().at(-1) || "";
  const week = new Date(Date.parse(last) - 6 * 86400e3).toISOString().slice(0, 10);
  const moves = moveAlerts(d.prices, rules, week).map((m) => `${m.d} ${m.ticker} ${m.change >= 0 ? "+" : ""}${m.change.toFixed(1)}% on ${m.volX.toFixed(1)}x volume`);
  return [
    `Data as of ${new Date(d.engine.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST. Prices are end of day, last session ${last}.`,
    `PORTFOLIO (mock, ${d.portfolio.length} holdings): value ${cr(s.value)}, last session ${s.dayPnl >= 0 ? "+" : "−"}${cr(Math.abs(s.dayPnl))} (${s.dayPct.toFixed(2)}%), 1 month ${s.m1Pct?.toFixed(1)}%. ${s.up} up, ${s.down} down.`,
    ...pos,
    `USER'S THRESHOLDS: price move ±${rules.moveAbs}%, volume ${rules.volMultiple}x 20-day average.`,
    `UNUSUAL MOVES at those thresholds, last week:`,
    ...(moves.length ? moves : ["none"]),
    `FILINGS, last 7 days, newest first ([ALERT] = crossed the user's thresholds):`,
    ...(feed.length ? feed : ["none"]),
    `RESEARCH FINN HAS PREPARED (from the companies' own transcripts and annual reports):`,
    ...(notes.length ? notes : ["none"]),
  ].join("\n");
}

const PROMPT = (ctx: string, history: Turn[]) => `You are FINN, a voice-first copilot for an Indian equity investor. You are talking, not writing: your reply is read aloud.
Use ONLY the data below. Never use outside knowledge about companies, markets or news, and never invent a number. If the data doesn't answer it, say so in one line and offer the closest thing you can do.
Style: a sharp analyst friend. Lead with the answer and the number. At most 70 words, plain sentences, no markdown, no lists, no emojis. Say "rupees" amounts the Indian way (lakh, crore). If the user speaks Hindi or Hinglish, reply in the same and set lang "hi-IN", otherwise "en-IN".
Screens you can open (set "open" only when it genuinely helps, with a short "label"):
  /digest?w=24h  today's filings, triaged         /inbox  everything that crossed their thresholds
  /portfolio  holdings                            /portfolio?h=TICKER  one holding: chart, filings
  /research/TICKER  deep research on ANY NSE company: promises vs delivery, guidance, bull/bear, financials
  /alerts  thresholds and notifications           /digest?t=TICKER  one company's filings
For questions about a company's management, guidance, promises, strategy or fundamentals, answer from RESEARCH if it's there, and open /research/TICKER either way. For a company not in the data, set "company" to its name and open /research/ with your best NSE symbol; say that FINN will read its calls now.
Ready-made research: ${RESEARCH_DEMO.join(", ")} and anything listed under RESEARCH.

${ctx}

${history.length ? `Conversation so far:\n${history.map((t) => `${t.role === "user" ? "User" : "FINN"}: ${t.text}`).join("\n")}\n` : ""}`;

export async function ask(input: { q?: string; audio?: { data: string; mime: string }; history?: Turn[]; rules?: Partial<Rules> }): Promise<CopilotReply> {
  const d = await loadDigest(70);
  if (!d) throw new Error("No portfolio data yet");
  const rules = { ...DEFAULT_RULES, ...(input.rules || {}) };
  const history = (input.history || []).slice(-6).map((t) => ({ role: t.role, text: String(t.text).slice(0, 400) }));
  const parts: Part[] = [{ text: PROMPT(context(d, rules, await researchNotes()), history) }];
  if (input.audio) {
    parts.push({ text: "The user's question is in this audio. Transcribe it into \"heard\", then answer it." });
    parts.push({ inline_data: { mime_type: input.audio.mime, data: input.audio.data } });
  } else {
    parts.push({ text: `User: ${String(input.q || "").slice(0, 500)}` });
  }
  const r = await llm({
    tier: "bulk",
    parts,
    json: true,
    schema: SCHEMA,
    temperature: 0.3,
    maxOutputTokens: 600,
    // Same question on the same data gives the same answer: the suggestion chips are instant.
    cacheId: input.audio || history.length ? undefined : `copilot-v1|${d.engine.generatedAt}|${JSON.stringify(rules)}|${String(input.q).toLowerCase().trim()}`,
  });
  const x = parseJSON<{ heard?: string | null; reply: string; lang: string; open: string | null; label?: string | null; company?: string | null }>(r.text);
  let open = x.open && x.open.startsWith("/") ? x.open : null;
  // Make sure a research link points at a real company.
  const m = open?.match(/^\/research\/([A-Za-z0-9&-]+)/);
  if (m && x.company && !d.portfolio.some((h) => h.ticker === m[1].toUpperCase()) && !RESEARCH_DEMO.includes(m[1].toUpperCase())) {
    const hit = await searchCompanies(x.company).then((h) => h[0]).catch(() => null);
    if (hit) open = `/research/${hit.ticker}`;
  }
  return { heard: x.heard ?? undefined, reply: x.reply, lang: x.lang === "hi-IN" ? "hi-IN" : "en-IN", path: open, label: x.label ?? undefined };
}
