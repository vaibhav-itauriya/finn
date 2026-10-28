import type { ResultsCard, Triplet } from "@/lib/types";
import { change, fmtCr, fmtPct } from "@/lib/client/format";
import clsx from "clsx";

function Delta({ v, label }: { v: number | null; label: string }) {
  const txt = v == null ? "–" : v === Infinity ? "to profit" : fmtPct(v);
  return (
    <span className="flex items-baseline justify-between gap-1">
      <span className="text-dim">{label}</span>
      <span className={clsx("font-bold num", v == null ? "text-dim" : v === Infinity || v > 0.05 ? "text-up" : v < -0.05 ? "text-down" : "text-dim")}>{txt}</span>
    </span>
  );
}

function Tile({ label, t }: { label: string; t: Triplet }) {
  return (
    <div className="rounded-xl bg-raise p-2.5">
      <p className="text-[11px] font-semibold text-dim">{label}</p>
      <p className="mt-0.5 text-[16px] font-extrabold tracking-tight num">₹{fmtCr(t.cur)}</p>
      <div className="mt-1 space-y-0.5 text-[11px]">
        <Delta v={change(t.cur, t.prevQ)} label="QoQ" />
        <Delta v={change(t.cur, t.prevY)} label="YoY" />
      </div>
    </div>
  );
}

/** Results first cut: the four headline numbers as a 2×2 grid, ₹ crore, vs last quarter and last year. */
export function ResultsTable({ r }: { r: ResultsCard }) {
  const mCur = r.revenue.cur && r.ebitda.cur != null ? (r.ebitda.cur / r.revenue.cur) * 100 : null;
  const mY = r.revenue.prevY && r.ebitda.prevY != null ? (r.ebitda.prevY / r.revenue.prevY) * 100 : null;
  return (
    <div className="mt-2.5">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={`Results in ₹ crore, ${r.basis}`}>
        <Tile label="Revenue" t={r.revenue} />
        <Tile label={r.ebitdaLabel} t={r.ebitda} />
        <Tile label="PBT" t={r.pbt} />
        <Tile label="PAT" t={r.pat} />
      </div>
      <p className="mt-2 text-[11.5px] text-dim num">
        ₹ crore, {r.basis}
        {!r.isLender && mCur != null && (
          <>
            {" "}
            · EBITDA margin {mCur.toFixed(1)}%{mY != null && <> vs {mY.toFixed(1)}% a year ago</>}
          </>
        )}
      </p>
      {r.exceptional && <p className="mt-1 text-[12px] font-semibold text-flag">{r.exceptional}</p>}
      {r.check && (
        <p className={clsx("mt-1 text-[11.5px] font-semibold", r.check.agrees ? "text-up" : "text-down")}>
          {r.check.agrees ? "✓ " : "⚠ "}
          {r.check.note}
        </p>
      )}
    </div>
  );
}
