"use client";
// The one portfolio summary, used at the top of Home and Portfolio so both read the same way:
// value, then three plain numbers under a hairline. No chart junk.
import clsx from "clsx";
import { inr, signed, type PortfolioSummary } from "@/lib/client/portfolio";
import { fmtPct } from "@/lib/client/format";

export function SummaryCard({ s, action }: { s: PortfolioSummary; action?: React.ReactNode }) {
  return (
    <section className="card mx-4 mt-2 p-4" aria-label="Portfolio summary">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-[12px] font-semibold text-dim">Current value</h1>
        {action}
      </div>
      <p className="mt-1 text-[30px] font-bold tracking-tight num">{inr(s.value)}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-rule pt-3 text-[12px]">
        <div>
          <p className="text-dim">Day&apos;s P&amp;L</p>
          <p className={clsx("mt-0.5 font-bold num", s.dayPnl >= 0 ? "text-up" : "text-down")}>
            {signed(s.dayPnl, (v) => inr(v, true))}
            <span className="block text-[11px] font-semibold">{fmtPct(s.dayPct, 2)}</span>
          </p>
        </div>
        <div>
          <p className="text-dim">1 month</p>
          <p className={clsx("mt-0.5 font-bold num", (s.m1Pct ?? 0) >= 0 ? "text-up" : "text-down")}>{fmtPct(s.m1Pct, 1)}</p>
          <p className="text-[11px] text-dim">value change</p>
        </div>
        <div>
          <p className="text-dim">Breadth</p>
          <p className="mt-0.5 font-bold num">
            <span className="text-up">{s.up}▲</span> <span className="text-down">{s.down}▼</span>
          </p>
          <p className="text-[11px] text-dim">of {s.positions.length} holdings</p>
        </div>
      </div>
    </section>
  );
}
