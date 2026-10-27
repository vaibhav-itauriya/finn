import type { ResultsCard, Triplet } from "@/lib/types";
import { change, fmtCr, fmtPct } from "@/lib/client/format";
import clsx from "clsx";

function Delta({ v }: { v: number | null }) {
  if (v == null) return <span className="text-dim">–</span>;
  if (v === Infinity) return <span className="text-up">to profit</span>;
  return <span className={clsx(v > 0.05 ? "text-up" : v < -0.05 ? "text-down" : "text-dim")}>{fmtPct(v)}</span>;
}

function Row({ label, t, strong }: { label: string; t: Triplet; strong?: boolean }) {
  return (
    <tr className="border-t border-rule">
      <th scope="row" className={clsx("py-1.5 pr-2 text-left font-normal", strong ? "text-ink" : "text-dim")}>
        {label}
      </th>
      <td className="py-1.5 text-right num font-medium">{fmtCr(t.cur)}</td>
      <td className="py-1.5 text-right num pl-3">
        <Delta v={change(t.cur, t.prevQ)} />
      </td>
      <td className="py-1.5 text-right num pl-3">
        <Delta v={change(t.cur, t.prevY)} />
      </td>
    </tr>
  );
}

export function ResultsTable({ r }: { r: ResultsCard }) {
  const margin = (t: Triplet, rev: Triplet) => ({
    cur: rev.cur && t.cur != null ? (t.cur / rev.cur) * 100 : null,
    y: rev.prevY && t.prevY != null ? (t.prevY / rev.prevY) * 100 : null,
  });
  const m = margin(r.ebitda, r.revenue);
  return (
    <div className="mt-2">
      <table className="w-full text-[13px]">
        <caption className="sr-only">Headline numbers in ₹ crore</caption>
        <thead>
          <tr className="text-[11px] text-dim">
            <th className="text-left font-normal pb-1">₹ cr, {r.basis}</th>
            <th className="text-right font-normal pb-1">{r.period.split(" (")[0]}</th>
            <th className="text-right font-normal pb-1 pl-3">QoQ</th>
            <th className="text-right font-normal pb-1 pl-3">YoY</th>
          </tr>
        </thead>
        <tbody>
          <Row label="Revenue" t={r.revenue} strong />
          <Row label={r.ebitdaLabel} t={r.ebitda} />
          <Row label="PBT" t={r.pbt} />
          <Row label="PAT" t={r.pat} strong />
        </tbody>
      </table>
      {!r.isLender && m.cur != null && (
        <p className="mt-1.5 text-[12px] text-dim num">
          EBITDA margin {m.cur.toFixed(1)}%{m.y != null && <> vs {m.y.toFixed(1)}% a year ago</>}
        </p>
      )}
      {r.exceptional && <p className="mt-1 text-[12px] text-marigold">{r.exceptional}</p>}
      {r.check && (
        <p className={clsx("mt-1 text-[11px]", r.check.agrees ? "text-dim" : "text-down")}>
          {r.check.agrees ? "✓ " : "⚠ "}
          {r.check.note}
        </p>
      )}
    </div>
  );
}
