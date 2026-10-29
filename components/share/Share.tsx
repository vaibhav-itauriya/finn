"use client";
// One Share button for every card. It opens a small sheet with everywhere the card can go:
// your own FINN bot on Telegram (the full formatted card), WhatsApp, Telegram to anyone,
// the phone's own share sheet (every app installed), or copy as text.
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Icon, type IconName } from "../Icon";
import { useTelegram } from "@/lib/client/telegram";

export interface SharePayload {
  title: string; // e.g. "KPITTECH · Results"
  text: string; // plain text body, may use *bold* for WhatsApp
  path: string; // where the link back into FINN points
  bot?: Record<string, unknown>; // what /api/telegram/send needs to rebuild the card for the FINN bot
}

export function ShareButton({ payload, label = "Share", className }: { payload: SharePayload; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={clsx("flex items-center gap-1 font-semibold text-brand", className)} aria-label={`Share ${payload.title}`}>
        <Icon name="share" size={14} />
        {label}
      </button>
      {/* Portal: cards are draggable (transformed), which would trap a fixed sheet inside them. */}
      {typeof document !== "undefined" && createPortal(<AnimatePresence>{open && <ShareSheet payload={payload} onClose={() => setOpen(false)} />}</AnimatePresence>, document.body)}
    </>
  );
}

function ShareSheet({ payload, onClose }: { payload: SharePayload; onClose: () => void }) {
  const tg = useTelegram();
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null);
  const [native, setNative] = useState(false);
  useEffect(() => {
    setNative(typeof navigator !== "undefined" && typeof navigator.share === "function");
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const url = typeof window !== "undefined" ? `${window.location.origin}${payload.path}` : payload.path;
  const plain = payload.text.replace(/\*/g, "");
  const done = (text: string) => {
    setStatus({ text });
    setTimeout(onClose, 1100);
  };

  const options: { key: string; icon: IconName; label: string; sub: string; tint: string; go: () => void; hide?: boolean }[] = [
    {
      key: "bot",
      icon: "telegram",
      label: tg.conn ? "Send to my FINN bot" : "Connect FINN bot",
      sub: tg.conn ? `To ${tg.conn.name}'s Telegram, as a full card` : "Two taps, then cards go to your Telegram",
      tint: "bg-[#229ED9] text-white",
      go: async () => {
        if (!tg.conn) return tg.connect();
        if (!payload.bot) return setStatus({ text: "This card can't be sent to the bot", bad: true });
        setStatus({ text: "Sending…" });
        try {
          await tg.send(payload.bot);
          done("Sent. Check Telegram.");
        } catch (e) {
          setStatus({ text: (e as Error).message, bad: true });
        }
      },
    },
    {
      key: "wa",
      icon: "whatsapp",
      label: "WhatsApp",
      sub: "Send to a chat or group",
      tint: "bg-[#25D366] text-white",
      go: () => {
        window.open(`https://wa.me/?text=${encodeURIComponent(`${payload.text}\n\n${url}`)}`, "_blank", "noopener");
        onClose();
      },
    },
    {
      key: "tgshare",
      icon: "send",
      label: "Telegram",
      sub: "Send to any Telegram chat",
      tint: "bg-[#229ED9]/15 text-[#229ED9]",
      go: () => {
        window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(plain)}`, "_blank", "noopener");
        onClose();
      },
    },
    {
      key: "more",
      icon: "share",
      label: "More apps",
      sub: "Mail, Slack, Messages and the rest",
      tint: "bg-brand-soft text-brand",
      hide: !native,
      go: async () => {
        try {
          await navigator.share({ title: payload.title, text: plain, url });
          onClose();
        } catch {
          /* cancelled */
        }
      },
    },
    {
      key: "copy",
      icon: "doc",
      label: "Copy text",
      sub: "With a link back to FINN",
      tint: "bg-raise text-ink",
      go: async () => {
        try {
          await navigator.clipboard.writeText(`${plain}\n\n${url}`);
          done("Copied");
        } catch {
          setStatus({ text: "Couldn't copy here", bad: true });
        }
      },
    },
  ];

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] bg-black/40" onClick={onClose} />
      <motion.section
        role="dialog"
        aria-label="Share"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 340 }}
        className="fixed inset-x-0 bottom-0 z-[70] mx-auto max-w-[520px] rounded-t-[22px] bg-sheet px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3 shadow-2xl"
      >
        <span className="mx-auto block h-1 w-10 rounded-full bg-rule" aria-hidden />
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[16px] font-extrabold tracking-tight">Share</p>
            <p className="truncate text-[12.5px] text-dim">{payload.title}</p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-raise" aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>
        <ul className="mt-3 divide-y divide-rule">
          {options
            .filter((o) => !o.hide)
            .map((o) => (
              <li key={o.key}>
                <button onClick={o.go} className="flex w-full items-center gap-3 py-3 text-left active:opacity-70">
                  <span className={clsx("grid h-10 w-10 shrink-0 place-items-center rounded-full", o.tint)}>
                    <Icon name={o.icon} size={19} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-bold">{o.label}</span>
                    <span className="block text-[12px] text-dim">{o.sub}</span>
                  </span>
                </button>
              </li>
            ))}
        </ul>
        {status && <p className={clsx("mt-1 text-center text-[13px] font-semibold", status.bad ? "text-down" : "text-up")}>{status.text}</p>}
        {tg.status === "waiting" && <p className="mt-1 text-center text-[12.5px] text-dim">Press Start in Telegram, then come back and send.</p>}
      </motion.section>
    </>
  );
}
