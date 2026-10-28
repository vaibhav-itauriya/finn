// "Generate 24h digest": one short analyst brief over items the funnel already scored.
// The model never sees raw filings here, only the compact, already-verified lines, so the
// brief can't invent numbers and costs a few hundred tokens.
import type { Digest } from "../types";
import { bundle } from "../client/bundle";
import { DEFAULT_RULES, moveAlerts } from "../client/alerts";
import { CATEGORY_LABEL } from "./classify";
import { llm, parseJSON } from "../llm/router";

export interface Brief {
  headline: string;
  bullets: { ticker: string; text: string }[];
  quiet: number; // holdings with nothing material
  items: number;
  model?: string;
  cached?: boolean;
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    headline: { type: "STRING", description: "<=12 words: the single most important thing in this window" },
    bullets: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { ticker: { type: "STRING" }, text: { type: "STRING" } }, required: ["ticker", "text"] },
    },
  },
  required: ["headline", "bullets"],
};

export async function buildBrief(d: Digest, hours: number): Promise<Brief> {
  const gen = new Date(d.engine.generatedAt).getTime();
  const since = gen - hours * 3600e3;
  const fs = d.filings.filter((f) => new Date(f.ts).getTime() >= since);
  const top = bundle(fs)
    .filter((b) => b.lead.tier !== "routine")
    .sort((a, z) => z.lead.score - a.lead.score)
    .slice(0, 25);
  const day = new Date(since + 5.5 * 3600e3).toISOString().slice(0, 10);
  const moves = moveAlerts(d.prices, DEFAULT_RULES, day);
  const lines = [
    ...top.map(({ lead: f }) => {
      const e = f.enrichment;
      const t = e?.kind === "results" ? `${e.period}: ${e.verdict}` : e?.kind === "summary" ? e.line : e?.kind === "management" ? e.people.map((p) => `${p.name} ${p.change} as ${p.role}`).join("; ") : f.title;
      return `- ${f.ticker} [${CATEGORY_LABEL[f.category]}, score ${f.score}] ${t}`;
    }),
    ...moves.map((m) => `- ${m.ticker} [Price/volume ${m.d}] ${m.change >= 0 ? "+" : ""}${m.change.toFixed(1)}% on the day, volume ${m.volX.toFixed(1)}x 20-day average`),
  ];
  const touched = new Set([...top.map((b) => b.lead.ticker), ...moves.map((m) => m.ticker)]);
  const quiet = d.portfolio.filter((h) => !touched.has(h.ticker)).length;
  if (!lines.length) return { headline: "Nothing moved the needle", bullets: [], quiet, items: 0 };

  const r = await llm({
    tier: "bulk",
    system:
      "You are an elite equity research analyst briefing a portfolio manager who owns every stock mentioned. Filter the noise and surface only what moves the needle. Be ruthless: a routine item never makes the brief.",
    parts: [
      {
        text: `These are the last ${hours} hours of filings and price moves for the portfolio, already classified and scored (higher = more material). Write:
- "headline": at most 12 words, the single most important thing.
- "bullets": at most 5, most important first. Each has the ticker and at most 22 words that state the fact with its numbers and why it matters to the holder. Merge items about the same company. No filler ("the company announced"), no praise, no advice to buy or sell.
Use only the facts below.

${lines.join("\n")}`,
      },
    ],
    json: true,
    schema: SCHEMA,
    cacheId: `brief-v1|${hours}|${top.map((b) => b.lead.id).join(",")}|${moves.map((m) => m.ticker + m.d).join(",")}`,
    maxOutputTokens: 800,
  });
  const b = parseJSON<{ headline: string; bullets: { ticker: string; text: string }[] }>(r.text);
  return { headline: b.headline, bullets: (b.bullets || []).slice(0, 5), quiet, items: lines.length, model: r.model, cached: r.cached };
}
