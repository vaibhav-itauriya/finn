"use client";
import { ShareWhatsApp, shareText } from "../ShareWhatsApp";
import { filingLine } from "@/lib/feed";
import { motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import Link from "next/link";
import { useState } from "react";
import clsx from "clsx";
import type { Filing } from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/push/classify";
import { RelTime } from "../RelTime";
import { ResultsTable } from "./ResultsTable";
import { SendToTelegram } from "../telegram/TelegramBanner";

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
  const lead = variant === "lead";
  return (
    <li className="relative overflow-hidden rounded-[14px]" id={f.id}>
      <motion.div style={{ opacity: doneOpacity }} className="absolute inset-0 flex items-center rounded-[14px] bg-up/15 pl-5 text-[13px] font-bold text-up" aria-hidden>
        Done
      </motion.div>
      <motion.div style={{ opacity: muteOpacity }} className="absolute inset-0 flex items-center justify-end rounded-[14px] bg-raise pr-5 text-[13px] font-bold text-dim" aria-hidden>
        Mute {CATEGORY_LABEL[f.category].toLowerCase()} for {f.ticker}
      </motion.div>
      <motion.article drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.6} onDragEnd={onDragEnd} style={{ x }} className="card relative touch-pan-y p-3.5">
        {lead && <span className="absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded-r bg-brand" aria-hidden />}
        <header className="flex items-center gap-2">
          <Link href={`/research/${f.ticker}`} className="text-[14px] font-extrabold tracking-tight">
            {f.ticker}
          </Link>
          <span className={clsx("rounded-md px-1.5 py-[1px] text-[11px] font-bold", lead ? "bg-brand-soft text-brand" : "bg-raise text-dim")}>{CATEGORY_LABEL[f.category]}</span>
          <time className="ml-auto text-[11.5px] text-dim num" dateTime={f.ts} title={new Date(f.ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}>
            <RelTime iso={f.ts} withTime />
          </time>
        </header>

        <button className="block w-full text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Headline f={f} />
        </button>

        {open && (
          <div>
            {e?.kind === "results" && <ResultsTable r={e} />}
            {e?.kind === "management" && <Management f={f} />}
            {!e && f.headline && f.headline !== f.title && <p className="mt-1.5 text-[12.5px] leading-snug text-dim line-clamp-4">{f.headline}</p>}
            {related.length > 0 && (
              <div className="mt-2.5">
                <button onClick={() => setShowRel((v) => !v)} className="text-[12px] font-semibold text-dim" aria-expanded={showRel}>
                  {related.length} related {related.length === 1 ? "filing" : "filings"} {showRel ? "▴" : "▾"}
                </button>
                {showRel && (
                  <ul className="mt-1.5 space-y-1">
                    {related.map((r) => (
                      <li key={r.id} className="text-[12px] leading-snug">
                        {r.pdf ? (
                          <a href={r.pdf} target="_blank" rel="noreferrer" className="text-brand">
                            {r.title}
                          </a>
                        ) : (
                          r.title
                        )}
                        <span className="text-dim"> · <RelTime iso={r.ts} /></span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <footer className="mt-3 flex items-center gap-3.5 border-t border-rule pt-2.5 text-[12px]">
              {f.pdf && (
                <a href={f.pdf} target="_blank" rel="noreferrer" className="font-semibold text-brand">
                  Filing
                </a>
              )}
              <Link href={`/research/${f.ticker}`} className="font-semibold text-brand">
                Research
              </Link>
              <SendToTelegram body={{ kind: "filing", id: f.id }} />
              <ShareWhatsApp text={whatsappText(f)} path={`/digest?f=${encodeURIComponent(f.id)}`} />
              <button onClick={() => setWhy((w) => !w)} className="font-semibold text-dim">
                Why?
              </button>
              <button onClick={() => onDone(f)} className="ml-auto rounded-full bg-raise px-3 py-1 font-bold">
                Done
              </button>
            </footer>
            {why && (
              <p className="mt-2 text-[11.5px] leading-snug text-dim">
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

function whatsappText(f: Filing) {
  const e = f.enrichment;
  const pct = (a: number | null, b: number | null) => (a == null || b == null || b <= 0 ? "–" : `${a >= b ? "+" : "−"}${Math.abs(((a - b) / b) * 100).toFixed(1)}%`);
  const head = `*${f.ticker}* · ${CATEGORY_LABEL[f.category]}`;
  if (e?.kind === "results") {
    const row = (l: string, t: { cur: number | null; prevQ: number | null; prevY: number | null }) => `${l}: ₹${t.cur?.toLocaleString("en-IN") ?? "–"} cr (QoQ ${pct(t.cur, t.prevQ)}, YoY ${pct(t.cur, t.prevY)})`;
    return shareText([head + ` · ${e.period.split(" (")[0]}`, e.verdict, row("Revenue", e.revenue), row(e.isLender ? "PPOP" : "EBITDA", e.ebitda), row("PBT", e.pbt), row("PAT", e.pat)]);
  }
  return shareText([head, filingLine(f)]);
}

function Headline({ f }: { f: Filing }) {
  const e = f.enrichment;
  if (e?.kind === "results")
    return (
      <p className="mt-1.5 text-[14px] leading-snug">
        <span className="font-bold">{e.period.split(" (")[0]}</span> <span className="text-dim">{e.period.match(/\((.*)\)/)?.[1]}</span>
        <span className="block font-medium">{e.verdict}</span>
      </p>
    );
  if (e?.kind === "management") {
    const p = e.people[0];
    const verb = { appointed: "appointed", resigned: "resigns", retired: "retires", redesignated: "redesignated", other: "changes role" }[p.change];
    return (
      <p className="mt-1.5 text-[14px] leading-snug">
        <span className="font-bold">{p.name}</span> {verb} as {p.role}
        {e.people.length > 1 && <span className="text-dim"> · +{e.people.length - 1} more</span>}
      </p>
    );
  }
  if (e?.kind === "summary") return <p className="mt-1.5 text-[14px] leading-snug">{e.line}</p>;
  return <p className="mt-1.5 text-[14px] leading-snug">{f.title}</p>;
}

function Management({ f }: { f: Filing }) {
  const e = f.enrichment;
  if (e?.kind !== "management") return null;
  return (
    <div className="mt-2.5 space-y-2.5">
      {e.people.map((p) => (
        <div key={p.name} className="rounded-xl bg-raise p-3 text-[12.5px]">
          <p>
            <span className="font-bold">{p.name}</span>
            <span className="text-dim">
              {" "}
              · {p.role} · {p.change}
              {p.effective ? ` w.e.f. ${p.effective}` : ""}
            </span>
          </p>
          {p.bio && <p className="mt-1 leading-snug">{p.bio}</p>}
          {p.previously && p.previously.length > 0 && <p className="mt-1 leading-snug text-dim">Previously: {p.previously.join("; ")}</p>}
          {p.sources && p.sources.length > 0 && (
            <p className="mt-1 text-[11px] text-dim">
              Sources:{" "}
              {p.sources.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noreferrer" className="mr-2 text-brand">
                  {s.title}
                </a>
              ))}
            </p>
          )}
        </div>
      ))}
      {e.reason && <p className="text-[12.5px] text-dim">Stated reason: {e.reason}</p>}
    </div>
  );
}
