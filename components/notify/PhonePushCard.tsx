"use client";
import clsx from "clsx";
import { Icon } from "../Icon";
import { usePhonePush } from "@/lib/client/push";

/** Turn on lock-screen notifications for this phone. Works without any account. */
export function PhonePushCard({ compact }: { compact?: boolean }) {
  const p = usePhonePush();
  const on = p.state === "on";
  return (
    <section className={clsx("card mx-4 p-4", compact ? "mt-3" : "mt-4")}>
      <div className="flex items-start gap-3">
        <span className={clsx("grid h-10 w-10 shrink-0 place-items-center rounded-full", on ? "bg-up/15 text-up" : "bg-brand-soft text-brand")}>
          <Icon name="phone" size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold">{on ? "Phone notifications are on" : "Notifications on this phone"}</p>
          <p className="mt-0.5 text-[12px] leading-snug text-dim">
            {p.state === "needs-install"
              ? "On iPhone, first add FINN to your Home Screen: tap Share, then Add to Home Screen. Open FINN from there and turn this on."
              : p.state === "denied"
                ? "Notifications are blocked for this site. Allow them in your browser's site settings, then come back."
                : p.state === "unsupported"
                  ? "This browser can't receive web notifications. Use Telegram below, or open FINN in Chrome."
                  : on
                    ? "Filings and moves that cross your thresholds arrive on your lock screen, plus a short wrap after market close."
                    : "Get a lock-screen alert the moment something crosses your thresholds. No sign-up."}
          </p>
        </div>
      </div>
      {(p.state === "off" || p.state === "busy") && (
        <button onClick={p.enable} disabled={p.state === "busy"} className="mt-3 w-full rounded-xl bg-brand py-2.5 text-[14px] font-bold text-brand-ink disabled:opacity-60">
          {p.state === "busy" ? "Checking…" : "Turn on notifications"}
        </button>
      )}
      {on && (
        <div className="mt-3 flex gap-2">
          <button onClick={p.test} className="flex-1 rounded-xl bg-raise py-2 text-[13px] font-bold">
            Send a test
          </button>
          <button onClick={p.disable} className="flex-1 rounded-xl bg-raise py-2 text-[13px] font-bold text-down">
            Turn off
          </button>
        </div>
      )}
      {p.error && <p className="mt-2 text-[12px] text-down">{p.error}</p>}
    </section>
  );
}
