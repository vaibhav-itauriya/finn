// Portfolio maths for the dashboard, computed from end-of-day bars in the browser.
import type { Digest, Holding } from "../types";
import { barStats } from "./alerts";

export interface Position {
  h: Holding;
  ltp: number | null;
  day: number | null; // % change on the last session
  dayPnl: number | null; // ₹
  value: number | null; // ₹
  m1: number | null; // % over ~21 sessions
  m3: number | null; // % over ~63 sessions (or as far back as the data goes)
  volX: number | null;
  spark: number[];
  asOf: string | null;
  filings7d: number;
  material7d: number;
}

export interface PortfolioSummary {
  positions: Position[];
  value: number;
  dayPnl: number;
  dayPct: number;
  m1Pct: number | null;
  up: number;
  down: number;
  asOf: string | null;
}

export function summarise(d: Digest): PortfolioSummary {
  const since7 = Date.now() - 7 * 86400e3;
  const positions: Position[] = d.portfolio.map((h) => {
    const bars = d.prices.find((p) => p.ticker === h.ticker)?.bars || [];
    const n = bars.length;
    const last = bars[n - 1];
    const prev = bars[n - 2];
    const m1Base = bars[Math.max(0, n - 22)];
    const m3Base = bars[Math.max(0, n - 64)];
    const qty = h.qty ?? 0;
    const st = n > 21 ? barStats(bars, n - 1) : null;
    const fs = d.filings.filter((f) => f.ticker === h.ticker && new Date(f.ts).getTime() >= since7);
    return {
      h,
      ltp: last?.c ?? null,
      day: last && prev ? ((last.c - prev.c) / prev.c) * 100 : null,
      dayPnl: last && prev ? (last.c - prev.c) * qty : null,
      value: last ? last.c * qty : null,
      m1: last && m1Base ? ((last.c - m1Base.c) / m1Base.c) * 100 : null,
      m3: last && m3Base ? ((last.c - m3Base.c) / m3Base.c) * 100 : null,
      volX: st ? st.volX : null,
      spark: bars.slice(-30).map((b) => b.c),
      asOf: last?.d ?? null,
      filings7d: fs.length,
      material7d: fs.filter((f) => f.tier === "material").length,
    };
  });
  const value = positions.reduce((s, p) => s + (p.value ?? 0), 0);
  const dayPnl = positions.reduce((s, p) => s + (p.dayPnl ?? 0), 0);
  const prevValue = value - dayPnl;
  const m1Prev = positions.reduce((s, p) => s + (p.value != null && p.m1 != null ? p.value / (1 + p.m1 / 100) : 0), 0);
  return {
    positions,
    value,
    dayPnl,
    dayPct: prevValue ? (dayPnl / prevValue) * 100 : 0,
    m1Pct: m1Prev ? ((value - m1Prev) / m1Prev) * 100 : null,
    up: positions.filter((p) => (p.day ?? 0) > 0).length,
    down: positions.filter((p) => (p.day ?? 0) < 0).length,
    asOf: positions.map((p) => p.asOf).filter(Boolean).sort().at(-1) ?? null,
  };
}

export const inr = (x: number, compact = false) => {
  if (compact && Math.abs(x) >= 1e7) return `₹${(x / 1e7).toFixed(2)} Cr`;
  if (compact && Math.abs(x) >= 1e5) return `₹${(x / 1e5).toFixed(2)} L`;
  return `₹${Math.round(x).toLocaleString("en-IN")}`;
};

export const signed = (x: number, fmt: (v: number) => string) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${fmt(Math.abs(x))}`;

// Sector colours: one hue each, readable in both themes.
export const SECTOR_PALETTE = ["#0E8A8A", "#3B82C4", "#8B5CF6", "#D97706", "#DB2777", "#059669", "#64748B", "#0EA5E9", "#B45309", "#7C3AED", "#16A34A", "#E11D48", "#0891B2", "#A16207"];

export interface SectorSlice {
  name: string;
  value: number;
  pnl: number;
  prev: number;
  day: number;
  tickers: string[];
  color: string;
}

/** Holdings grouped by sector, largest first, each with a stable colour. */
export function sectorMix(s: PortfolioSummary): SectorSlice[] {
  const m = new Map<string, { value: number; pnl: number; prev: number; tickers: string[] }>();
  for (const p of s.positions) {
    const x = m.get(p.h.sector) || { value: 0, pnl: 0, prev: 0, tickers: [] };
    x.value += p.value ?? 0;
    x.pnl += p.dayPnl ?? 0;
    x.prev += (p.value ?? 0) - (p.dayPnl ?? 0);
    x.tickers.push(p.h.ticker);
    m.set(p.h.sector, x);
  }
  return [...m.entries()]
    .map(([name, x], i) => ({ name, ...x, day: x.prev ? (x.pnl / x.prev) * 100 : 0, color: SECTOR_PALETTE[i % SECTOR_PALETTE.length] }))
    .sort((a, b) => b.value - a.value);
}
