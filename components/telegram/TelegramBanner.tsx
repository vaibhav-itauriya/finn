"use client";
import { useState } from "react";
import clsx from "clsx";
import { Icon } from "../Icon";
import { useTelegram } from "@/lib/client/telegram";

/** Home-screen card: connect your own Telegram in two taps, then get the digest there. */
export function TelegramBanner({ compact }: { compact?: boolean }) {
  const tg = useTelegram();
  const [sent, setSent] = useState<string | null>(null);
  if (tg.cfg && !tg.cfg.enabled)
    return compact ? (
      <section className="card mx-4 mt-3 p-4 text-[12.5px] text-dim">
        Telegram isn&apos;t switched on for this deployment yet (the server can&apos;t see a bot token). Once it is, a Connect Telegram button appears here and on Home.
      </section>
    ) : null;

  if (tg.conn)
    return (
      <section className={clsx("card mx-4 flex items-center gap-3 p-3.5", compact ? "mt-3" : "mt-4")}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#229ED9] text-white">
          <Icon name="telegram" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold">Alerts go to {tg.conn.name}&apos;s Telegram</p>
          <p className="text-[11.5px] text-dim">{sent ?? (tg.cfg?.scheduled ? "New items arrive after every run, at your thresholds" : "Tap Send on any card to get it on your phone")}</p>
        </div>
        <button
          onClick={async () => {
            setSent("Sending…");
            try {
              await tg.send({ kind: "digest", hours: 24 });
              setSent("Sent. Check Telegram.");
            } catch (e) {
              setSent((e as Error).message);
            }
          }}
          className="shrink-0 rounded-full bg-brand px-3 py-1.5 text-[12px] font-bold text-brand-ink"
        >
          Send digest
        </button>
      </section>
    );

  return (
    <section className={clsx("card mx-4 p-4", compact ? "mt-3" : "mt-4")}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#229ED9] text-white">
          <Icon name="telegram" size={20} />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-bold">Get these alerts on your phone</p>
          <p className="mt-0.5 text-[12px] leading-snug text-dim">
            Connect your own Telegram in two taps. No sign-up: FINN opens the bot, you press Start, and results cards and unusual moves come to you.
          </p>
        </div>
      </div>
      {tg.status === "waiting" ? (
        <div className="mt-3 rounded-xl bg-brand-soft p-3 text-[12.5px]" aria-live="polite">
          <p className="font-semibold text-brand">Waiting for you to press Start in Telegram…</p>
          {tg.link && (
            <a href={tg.link} target="_blank" rel="noreferrer" className="mt-1 block text-brand underline">
              Telegram didn&apos;t open? Tap here.
            </a>
          )}
        </div>
      ) : (
        <button onClick={tg.connect} className="mt-3 w-full rounded-xl bg-brand py-2.5 text-[14px] font-bold text-brand-ink">
          Connect Telegram
        </button>
      )}
      {tg.error && <p className="mt-2 text-[12px] text-down">{tg.error}</p>}
    </section>
  );
}

/** Small "send this card to my Telegram" action. Hidden until Telegram is connected. */
export function SendToTelegram({ body }: { body: Record<string, unknown> }) {
  const tg = useTelegram();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  if (!tg.conn) return null;
  return (
    <button
      onClick={async () => {
        setState("sending");
        try {
          await tg.send(body);
          setState("sent");
        } catch {
          setState("error");
        }
      }}
      className={clsx("flex items-center gap-1 font-semibold", state === "error" ? "text-down" : "text-brand")}
      aria-label="Send to my Telegram"
    >
      <Icon name={state === "sent" ? "check" : "send"} size={14} />
      {state === "sent" ? "Sent" : state === "sending" ? "Sending" : state === "error" ? "Retry" : "Telegram"}
    </button>
  );
}
