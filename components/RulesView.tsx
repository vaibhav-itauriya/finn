"use client";
import { useEffect, useRef } from "react";
import clsx from "clsx";
import type { Category, PriceSeries } from "@/lib/types";
import { DEFAULT_RULES, alertBudget } from "@/lib/client/alerts";
import { useRules } from "@/lib/client/prefs";
import { syncRules, useTelegram } from "@/lib/client/telegram";
import { CATEGORY_LABEL } from "@/lib/push/classify";
import { AppHeader } from "./AppHeader";
import { Icon } from "./Icon";
import { TelegramBanner } from "./telegram/TelegramBanner";

const PUSHABLE: Category[] = ["results", "mna", "management_change", "fund_raise", "pledging", "litigation", "credit_rating", "insider_trading", "capex", "bonus_split", "dividend", "press_release"];

export function RulesView({ prices }: { prices: PriceSeries[] }) {
  const [rules, setRules, ready] = useRules();
  const tg = useTelegram();
  const budget = alertBudget(prices, rules, 30);

  // Connected testers get scheduled pushes at the same thresholds they see here.
  const first = useRef(true);
  useEffect(() => {
    if (!ready) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => syncRules(rules), 800);
    return () => clearTimeout(t);
  }, [rules, ready]);

  return (
    <main>
      <AppHeader />
      <header className="px-4 pt-2">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">Alerts</h1>
        <p className="mt-1 text-[13px] leading-snug text-dim">
          You decide what counts as unusual. With these lines your portfolio would have pinged you{" "}
          <b className="text-ink num">
            {budget} {budget === 1 ? "time" : "times"}
          </b>{" "}
          in the last 30 days.
        </p>
      </header>

      <section className="card mx-4 mt-4 space-y-6 p-4">
        <Slider label="Daily price move" hint="Close vs previous close" value={rules.moveAbs} min={2} max={10} step={0.5} fmt={(v) => `±${v}%`} onChange={(v) => setRules((r) => ({ ...r, moveAbs: v }))} />
        <Slider label="Volume spike" hint="Day's volume vs its 20-day average" value={rules.volMultiple} min={1.5} max={5} step={0.25} fmt={(v) => `${v}×`} onChange={(v) => setRules((r) => ({ ...r, volMultiple: v }))} />
      </section>

      <section className="card mx-4 mt-3 p-4">
        <h2 className="text-[14px] font-bold">Always push these filing types</h2>
        <p className="mt-0.5 text-[12px] text-dim">Everything else still shows up, ranked by how material FINN thinks it is.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {PUSHABLE.map((c) => {
            const on = rules.pushCategories.includes(c);
            return (
              <button
                key={c}
                aria-pressed={on}
                onClick={() => setRules((r) => ({ ...r, pushCategories: on ? r.pushCategories.filter((x) => x !== c) : [...r.pushCategories, c] }))}
                className={clsx("flex items-center gap-1 rounded-full px-3 py-1.5 text-[12.5px] font-semibold", on ? "bg-brand text-brand-ink" : "bg-raise text-dim")}
              >
                {on && <Icon name="check" size={13} />}
                {CATEGORY_LABEL[c]}
              </button>
            );
          })}
        </div>
      </section>

      <h2 className="mx-4 mt-6 text-[13px] font-bold text-dim">Push to your phone</h2>
      <TelegramBanner compact />
      {tg.conn && (
        <div className="mx-4 mt-2 flex items-center justify-between text-[12px]">
          <span className="text-dim">Chat ID {tg.conn.chatId} · stored only in this browser</span>
          <button onClick={tg.disconnect} className="font-semibold text-down">
            Disconnect
          </button>
        </div>
      )}

      <section className="card mx-4 mt-6 p-4">
        <h2 className="text-[14px] font-bold">Muted</h2>
        {rules.muted.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-dim">Nothing muted. Swipe a filing left in the Digest to mute that kind of filing for that company.</p>
        ) : (
          <ul className="mt-2 divide-y divide-rule">
            {rules.muted.map((m) => {
              const [t, c] = m.split(":");
              return (
                <li key={m} className="flex items-center justify-between py-2.5 text-[13.5px]">
                  <span>
                    <span className="font-bold">{t}</span> <span className="text-dim">{CATEGORY_LABEL[c as Category] ?? c}</span>
                  </span>
                  <button className="text-[12.5px] font-semibold text-brand" onClick={() => setRules((r) => ({ ...r, muted: r.muted.filter((x) => x !== m) }))}>
                    Unmute
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <button className="mx-4 mt-6 mb-4 text-[12.5px] font-semibold text-dim underline" onClick={() => setRules(DEFAULT_RULES)}>
        Reset to defaults
      </button>
    </main>
  );
}

function Slider({ label, hint, value, min, max, step, fmt, onChange }: { label: string; hint: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  const id = label.replace(/\W+/g, "-").toLowerCase();
  return (
    <div>
      <div className="flex items-end justify-between">
        <label htmlFor={id}>
          <span className="block text-[14px] font-bold">{label}</span>
          <span className="block text-[11.5px] text-dim">{hint}</span>
        </label>
        <span className="rounded-lg bg-brand-soft px-2.5 py-1 text-[18px] font-extrabold text-brand num">{fmt(value)}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-3 w-full" />
    </div>
  );
}
