"use client";
import clsx from "clsx";
import type { Category, PriceSeries } from "@/lib/types";
import { DEFAULT_RULES, alertBudget } from "@/lib/client/alerts";
import { useRules } from "@/lib/client/prefs";
import { CATEGORY_LABEL } from "@/lib/push/classify";

const PUSHABLE: Category[] = ["results", "mna", "management_change", "fund_raise", "pledging", "litigation", "credit_rating", "insider_trading", "capex", "bonus_split", "dividend", "press_release"];

export function RulesView({ prices }: { prices: PriceSeries[] }) {
  const [rules, setRules] = useRules();
  const budget = alertBudget(prices, rules, 30);

  return (
    <main className="px-4 pt-[max(16px,env(safe-area-inset-top))]">
      <p className="text-[15px] font-semibold tracking-tight">FINN</p>
      <h1 className="mt-5 text-[40px] leading-[1.02] font-semibold tracking-[-0.03em]">You decide what&apos;s unusual.</h1>
      <p className="mt-2 text-[14px] text-dim leading-snug">
        With these lines, your portfolio would have pinged you <span className="text-ink font-semibold num">{budget}</span> {budget === 1 ? "time" : "times"} for price or
        volume in the last 30 days. Move a slider and watch that number.
      </p>

      <section className="mt-8 space-y-7">
        <Slider
          label="Daily price move"
          value={rules.moveAbs}
          min={2}
          max={10}
          step={0.5}
          fmt={(v) => `±${v}%`}
          onChange={(v) => setRules((r) => ({ ...r, moveAbs: v }))}
        />
        <Slider
          label="Volume vs its 20-day average"
          value={rules.volMultiple}
          min={1.5}
          max={5}
          step={0.25}
          fmt={(v) => `${v}×`}
          onChange={(v) => setRules((r) => ({ ...r, volMultiple: v }))}
        />
      </section>

      <section className="mt-10">
        <h2 className="text-[13px] font-semibold text-dim">Always put these filing types at the top</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {PUSHABLE.map((c) => {
            const on = rules.pushCategories.includes(c);
            return (
              <button
                key={c}
                aria-pressed={on}
                onClick={() =>
                  setRules((r) => ({ ...r, pushCategories: on ? r.pushCategories.filter((x) => x !== c) : [...r.pushCategories, c] }))
                }
                className={clsx("rounded-full border px-3 py-1.5 text-[13px]", on ? "border-ink bg-ink text-paper" : "border-rule text-dim")}
              >
                {CATEGORY_LABEL[c]}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-dim">Everything else still shows up, ranked by how material FINN thinks it is.</p>
      </section>

      <section className="mt-10">
        <h2 className="text-[13px] font-semibold text-dim">Muted</h2>
        {rules.muted.length === 0 ? (
          <p className="mt-2 text-[13px] text-dim">Nothing muted. Swipe a filing left on Today to mute that kind of filing for that company.</p>
        ) : (
          <ul className="mt-2 divide-y divide-rule border-y border-rule">
            {rules.muted.map((m) => {
              const [t, c] = m.split(":");
              return (
                <li key={m} className="flex items-center justify-between py-2.5 text-[14px]">
                  <span>
                    <span className="font-medium">{t}</span> <span className="text-dim">{CATEGORY_LABEL[c as Category] ?? c}</span>
                  </span>
                  <button className="text-[13px] text-slate font-medium" onClick={() => setRules((r) => ({ ...r, muted: r.muted.filter((x) => x !== m) }))}>
                    Unmute
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <button className="mt-10 mb-4 text-[13px] text-dim underline" onClick={() => setRules(DEFAULT_RULES)}>
        Reset to defaults
      </button>
    </main>
  );
}

function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  const id = label.replace(/\W+/g, "-").toLowerCase();
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[15px]">
          {label}
        </label>
        <span className="text-[22px] font-semibold num tracking-tight">{fmt(value)}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-[rgb(var(--marigold))]" />
    </div>
  );
}
