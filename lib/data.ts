// Server-side loader for the pipeline's output. Pages read it at build time (every data commit
// redeploys), trim what the phone doesn't need, and merge in the config (mock quantities).
import { promises as fs } from "node:fs";
import path from "node:path";
import { PORTFOLIO } from "@/config/portfolio";
import type { Digest } from "./types";

export async function loadDigest(bars = 70): Promise<Digest | null> {
  try {
    const d = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "digest.json"), "utf8")) as Digest;
    d.prices = d.prices.map((p) => ({ ...p, bars: p.bars.slice(-bars) }));
    const cfg = new Map(PORTFOLIO.map((h) => [h.ticker, h]));
    d.portfolio = d.portfolio.map((h) => ({ ...h, ...cfg.get(h.ticker), bse: h.bse }));
    return d;
  } catch {
    return null;
  }
}
