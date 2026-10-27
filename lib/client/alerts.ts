// Triggered alerts on end-of-day data. Computed in the browser from the shipped price series,
// so moving a threshold slider re-evaluates history instantly: the investor decides what
// "unusual" means and immediately sees how noisy that choice would have been.
import type { Bar, Category, PriceSeries } from "../types";

export interface Rules {
  volMultiple: number; // volume vs 20-day average
  moveAbs: number; // |daily % change|
  pushCategories: Category[]; // always surface these filing types at the top
  muted: string[]; // "TICKER:category" pairs the user swiped away
}

export const DEFAULT_RULES: Rules = {
  volMultiple: 2,
  moveAbs: 4,
  pushCategories: ["results", "mna", "management_change", "fund_raise", "pledging", "litigation", "credit_rating"],
  muted: [],
};

export interface MoveAlert {
  ticker: string;
  d: string;
  close: number;
  change: number; // %
  volX: number; // multiple of 20d avg
  kinds: ("price" | "volume")[];
  spark: number[]; // last 30 closes ending at d
}

function avg(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function barStats(bars: Bar[], i: number) {
  const prev = bars[i - 1];
  const change = prev ? ((bars[i].c - prev.c) / prev.c) * 100 : 0;
  const window = bars.slice(Math.max(0, i - 20), i).map((b) => b.v);
  const a = avg(window);
  return { change, volX: a ? bars[i].v / a : 0 };
}

export function moveAlerts(series: PriceSeries[], rules: Rules, sinceDay: string): MoveAlert[] {
  const out: MoveAlert[] = [];
  for (const s of series) {
    for (let i = 21; i < s.bars.length; i++) {
      const b = s.bars[i];
      if (b.d < sinceDay) continue;
      const { change, volX } = barStats(s.bars, i);
      const kinds: MoveAlert["kinds"] = [];
      if (Math.abs(change) >= rules.moveAbs) kinds.push("price");
      if (volX >= rules.volMultiple) kinds.push("volume");
      if (kinds.length)
        out.push({ ticker: s.ticker, d: b.d, close: b.c, change, volX, kinds, spark: s.bars.slice(Math.max(0, i - 29), i + 1).map((x) => x.c) });
    }
  }
  // Biggest surprises first: combine both dimensions on a comparable scale.
  return out.sort((a, b) => b.d.localeCompare(a.d) || score(b, rules) - score(a, rules));
}

function score(a: MoveAlert, r: Rules) {
  return Math.abs(a.change) / r.moveAbs + a.volX / r.volMultiple;
}

/** How many alerts these rules would have produced over the whole history (for the rules screen). */
export function alertBudget(series: PriceSeries[], rules: Rules, days = 30) {
  const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
  return moveAlerts(series, rules, since).length;
}
