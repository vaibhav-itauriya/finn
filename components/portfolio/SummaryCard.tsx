"use client";
// The one portfolio summary, used at the top of Home and Portfolio so both read the same way.
import clsx from "clsx";
import { Icon } from "../Icon";
import { askFinn } from "../copilot/Copilot";
import { inr, signed, type PortfolioSummary, type SectorSlice } from "@/lib/client/portfolio";
import { fmtPct } from "@/lib/client/format";

export function SummaryCard({ s, sectors, holdings, action }: { s: PortfolioSummary; sectors: SectorSlice[]; holdings: number; action?: React.ReactNode }) {
  return (
    <section className="card mx-4 mt-2 p-4" aria-label="Portfolio summary">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[12px] font-semibold text-dim">Current value · {holdings} holdings</h1>
          <p className="mt-1 text-[30px] font-extrabold leading-none tracking-tight num">{inr(s.value)}</p>
        </div>
        {action ?? (
          <button onClick={() => askFinn("How did my portfolio do and why?")} className="flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-[12px] font-bold text-brand" aria-label="Ask FINN to explain your portfolio">
            <Icon name="mic" size={14} /> Explain
          </button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
        <Tile label="Last session" value={signed(s.dayPnl, (v) => inr(v, true))} sub={fmtPct(s.dayPct, 2)} tone={s.dayPnl} />
        <Tile label="1 month" value={fmtPct(s.m1Pct, 1)} sub="value change" tone={s.m1Pct ?? 0} />
        <Tile
          label="Breadth"
          value={
            <>
              <span className="text-up">{s.up}▲</span> <span className="text-down">{s.down}▼</span>
            </>
          }
          sub={`of ${s.positions.length}`}
        />
      </div>
      <div className="mt-3 flex h-2 gap-px overflow-hidden rounded-full" role="img" aria-label={`Sector mix: ${sectors.map((x) => `${x.name} ${((x.value / s.value) * 100).toFixed(0)}%`).join(", ")}`}>
        {sectors.map((x) => (
          <span key={x.name} style={{ width: `${(x.value / s.value) * 100}%`, background: x.color }} className="h-full" />
        ))}
      </div>
      <p className="mt-2 text-[10.5px] leading-snug text-dim">Mock quantities for the demo. End-of-day prices from Yahoo Finance as of {s.asOf}.</p>
    </section>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: number }) {
  const c = tone == null ? "" : tone >= 0 ? "text-up" : "text-down";
  return (
    <div className="rounded-xl bg-raise px-2.5 py-2">
      <p className="text-[11px] text-dim">{label}</p>
      <p className={clsx("mt-0.5 text-[14px] font-extrabold num", c)}>{value}</p>
      {sub && <p className={clsx("text-[11px] font-semibold num", c || "text-dim")}>{sub}</p>}
    </div>
  );
}
