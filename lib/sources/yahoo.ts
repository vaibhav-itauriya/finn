// End-of-day price and volume from Yahoo Finance's chart endpoint (same data yfinance uses).
import type { Bar } from "../types";
import { getJSON } from "../util/http";

interface ChartResp {
  chart: {
    result?: {
      timestamp: number[];
      indicators: { quote: { close: (number | null)[]; volume: (number | null)[] }[] };
    }[];
    error?: { description: string } | null;
  };
}

export async function fetchEOD(nseTicker: string, range = "6mo"): Promise<Bar[]> {
  const sym = encodeURIComponent(`${nseTicker}.NS`);
  let lastErr: unknown;
  for (const host of ["query1", "query2"]) {
    try {
      const j = await getJSON<ChartResp>(
        `https://${host}.finance.yahoo.com/v8/finance/chart/${sym}?range=${range}&interval=1d&includePrePost=false`,
      );
      const r = j.chart.result?.[0];
      if (!r) throw new Error(j.chart.error?.description || "no result");
      const q = r.indicators.quote[0];
      const bars: Bar[] = [];
      r.timestamp.forEach((ts, i) => {
        const c = q.close[i];
        const v = q.volume[i];
        if (c == null || v == null) return;
        const d = new Date((ts + 5.5 * 3600) * 1000).toISOString().slice(0, 10);
        // Yahoo sometimes repeats the live bar; keep the last value per day.
        if (bars.length && bars[bars.length - 1].d === d) bars[bars.length - 1] = { d, c: round2(c), v };
        else bars.push({ d, c: round2(c), v });
      });
      return bars;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const round2 = (x: number) => Math.round(x * 100) / 100;
