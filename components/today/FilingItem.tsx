"use client";
import { motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import Link from "next/link";
import { useState } from "react";
import clsx from "clsx";
import type { Filing } from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/push/classify";
import { istTime, relTime } from "@/lib/client/format";
import { ResultsTable } from "./ResultsTable";

interface Props {
  f: Filing;
  related?: Filing[];
  defaultOpen?: boolean;
  variant: "lead" | "glance";
  onDone: (f: Filing) => void;
  onMute: (f: Filing) => void;
}

/** Swipe right = done, swipe left = mute this kind of filing for this company. Buttons do the same. */
export function FilingItem({ f, related = [], variant, defaultOpen, onDone, onMute }: Props) {
  const x = useMotionValue(0);
  const doneOpacity = useTransform(x, [20, 90], [0, 1]);
  const muteOpacity = useTransform(x, [-90, -20], [1, 0]);
  const [open, setOpen] = useState(defaultOpen ?? variant === "lead");
  const [why, setWhy] = useState(false);
  const [showRel, setShowRel] = useState(false);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > 110) onDone(f);
    else if (info.offset.x < -110) onMute(f);
  };

  const e = f.enrichment;
  return (
    <li className="relative overflow-hidden">
      <motion.div style={{ opacity: doneOpacity }} className="absolute inset-0 flex items-center pl-5 text-up text-[13px] font-semibold bg-up/10" aria-hidden>
        Done
      </motion.div>
      <motion.div style={{ opacity: muteOpacity }} className="absolute inset-0 flex items-center justify-end pr-5 text-dim text-[13px] font-semibold bg-ink/5" aria-hidden>
        Mute {CATEGORY_LABEL[f.category].toLowerCase()} for {f.ticker}
      </motion.div>
      <motion.article
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.6}
        onDragEnd={onDragEnd}
        style={{ x }}
        className={clsx("relative bg-sheet touch-pan-y", variant === "lead" ? "px-4 py-4" : "px-4 py-3")}
      >
        {variant === "lead" && <span className="absolute left-0 top-4 bottom-4 w-[3px] rounded-r bg-marigold" aria-hidden />}
        <header className="flex items-baseline gap-2">
          <Link href={`/research/${f.ticker}`} className="font-semibold text-[15px] tracking-tight hover:underline">
            {f.ticker}
          </Link>
          <span className="text-[12px] text-dim">{CATEGORY_LABEL[f.category]}</span>
          <time className="ml-auto text-[12px] text-dim num" dateTime={f.ts} title={new Date(f.ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}>
            {relTime(f.ts).endsWith("ago") ? relTime(f.ts) : `${relTime(f.ts)}, ${istTime(f.ts)}`}
          </time>
        </header>

        <button className="block w-full text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Headline f={f} />
        </button>

        {open && (
          <div>
            {e?.kind === "results" && <ResultsTable r={e} />}
            {e?.kind === "management" && <Management f={f} />}
            {!e && f.headline && f.headline !== f.title && <p className="mt-1.5 text-[13px] text-dim leading-snug line-clamp-4">{f.headline}</p>}
            {related.length > 0 && (
              <div className="mt-2.5">
                <button onClick={() => setShowRel((x) => !x)} className="text-[12px] text-dim" aria-expanded={showRel}>
                  {related.length} related {related.length === 1 ? "filing" : "filings"} {showRel ? "▴" : "▾"}
                </button>
                {showRel && (
                  <ul className="mt-1.5 space-y-1">
                    {related.map((r) => (
                      <li key={r.id} className="text-[12px] leading-snug">
                        {r.pdf ? (
                          <a href={r.pdf} target="_blank" rel="noreferrer" className="text-slate">
                            {r.title}
                          </a>
                        ) : (
                          r.title
                        )}
                        <span className="text-dim"> · {relTime(r.ts)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <footer className="mt-3 flex items-center gap-4 text-[12px]">
              {f.pdf && (
                <a href={f.pdf} target="_blank" rel="noreferrer" className="text-slate font-medium">
                  Open filing
                </a>
              )}
              <Link href={`/research/${f.ticker}`} className="text-slate font-medium">
                Research {f.ticker}
              </Link>
              <button onClick={() => setWhy((w) => !w)} className="text-dim">
                Why here?
              </button>
              <button onClick={() => onDone(f)} className="ml-auto rounded-full border border-rule px-3 py-1 font-medium">
                Done
              </button>
            </footer>
            {why && (
              <p className="mt-2 text-[12px] text-dim">
                Score {f.score}/100. {f.reason}. Sorted by {f.classifiedBy === "rules" ? "exchange metadata rules" : "the model, because no rule matched"}. BSE: {f.bseCategory}
                {f.bseSub ? ` / ${f.bseSub}` : ""}.
              </p>
            )}
          </div>
        )}
      </motion.article>
    </li>
  );
}

function Headline({ f }: { f: Filing }) {
  const e = f.enrichment;
  if (e?.kind === "results")
    return (
      <p className="mt-1 text-[15px] leading-snug">
        <span className="font-medium">{e.period}</span>
        <span className="text-dim"> · </span>
        {e.verdict}
      </p>
    );
  if (e?.kind === "management") {
    const p = e.people[0];
    const verb = { appointed: "appointed", resigned: "resigns", retired: "retires", redesignated: "redesignated", other: "changes role" }[p.change];
    return (
      <p className="mt-1 text-[15px] leading-snug">
        {e.people.length > 1 ? `${e.people.length} changes: ` : ""}
        <span className="font-medium">{p.name}</span> {verb} as {p.role}
      </p>
    );
  }
  if (e?.kind === "summary") return <p className="mt-1 text-[15px] leading-snug">{e.line}</p>;
  return <p className="mt-1 text-[15px] leading-snug">{f.title}</p>;
}

function Management({ f }: { f: Filing }) {
  const e = f.enrichment;
  if (e?.kind !== "management") return null;
  return (
    <div className="mt-2 space-y-3">
      {e.people.map((p) => (
        <div key={p.name} className="text-[13px]">
          <p>
            <span className="font-medium">{p.name}</span>
            <span className="text-dim">
              {" "}
              · {p.role} · {p.change}
              {p.effective ? ` w.e.f. ${p.effective}` : ""}
            </span>
          </p>
          {p.bio && <p className="mt-0.5 leading-snug">{p.bio}</p>}
          {p.previously && p.previously.length > 0 && <p className="mt-0.5 text-dim leading-snug">Previously: {p.previously.join("; ")}</p>}
          {p.sources && p.sources.length > 0 && (
            <p className="mt-0.5 text-[11px] text-dim">
              Sources:{" "}
              {p.sources.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noreferrer" className="text-slate mr-2">
                  {s.title}
                </a>
              ))}
            </p>
          )}
        </div>
      ))}
      {e.reason && <p className="text-[13px] text-dim">Stated reason: {e.reason}</p>}
    </div>
  );
}
