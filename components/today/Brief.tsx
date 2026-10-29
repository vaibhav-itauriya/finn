"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import type { Brief as B } from "@/lib/push/brief";
import { speak, stopSpeaking, useSpeaking } from "@/lib/client/speech";

const spoken = (b: B, hours: number) =>
  [`Here's your ${hours >= 48 ? `${Math.round(hours / 24)} day` : `${hours} hour`} read.`, b.headline + ".", ...b.bullets.map((x) => `${x.ticker}: ${x.text}`), b.quiet ? `${b.quiet} holdings had nothing material.` : ""].join(" ");

/** "FINN's read": a five-line analyst brief over the window, written on demand. */
export function Brief({ hours, auto }: { hours: number; auto?: boolean }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [b, setB] = useState<B | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const speaking = useSpeaking();

  const run = async (andSpeak = false) => {
    setState("loading");
    setErr(null);
    try {
      const r = await fetch(`/api/brief?hours=${hours}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "failed");
      setB(j.data);
      setState("done");
      if (andSpeak) speak(spoken(j.data, hours));
    } catch (e) {
      setErr((e as Error).message);
      setState("error");
    }
  };

  useEffect(() => {
    setB(null);
    setState("idle");
    stopSpeaking();
    if (auto) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, auto]);

  return (
    <section className="mx-4 mt-4 overflow-hidden rounded-[14px] bg-hero p-4 text-hero-ink" aria-live="polite">
      <div className="flex items-center gap-2 text-[12px] font-bold opacity-90">
        <Icon name="spark" size={15} />
        FINN&apos;s read on the last {hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours} hours`}
        {state === "done" && b && (
          <button
            onClick={() => (speaking ? stopSpeaking() : speak(spoken(b, hours)))}
            className="ml-auto flex items-center gap-1 rounded-full bg-hero-ink/15 px-2.5 py-1 text-[11.5px] font-bold"
            aria-label={speaking ? "Stop reading" : "Listen to the brief"}
          >
            <Icon name={speaking ? "stop" : "speaker"} size={13} />
            {speaking ? "Stop" : "Listen"}
          </button>
        )}
      </div>
      {state === "idle" && (
        <div className="mt-2.5 flex gap-2">
          <button onClick={() => run()} className="flex-1 rounded-xl bg-hero-ink/15 py-2.5 text-[14px] font-bold">
            Generate brief
          </button>
          <button onClick={() => run(true)} className="flex items-center gap-1.5 rounded-xl bg-hero-ink/15 px-4 py-2.5 text-[14px] font-bold" aria-label="Generate the brief and read it aloud">
            <Icon name="play" size={15} /> Listen
          </button>
        </div>
      )}
      {state === "loading" && <p className="mt-2 text-[14px] font-semibold opacity-90">Reading the scored filings…</p>}
      {state === "error" && (
        <p className="mt-2 text-[13px]">
          Couldn&apos;t write the brief ({err}).{" "}
          <button onClick={() => run()} className="font-bold underline">
            Try again
          </button>
        </p>
      )}
      {state === "done" && b && (
        <>
          <p className="mt-1.5 text-[17px] font-extrabold leading-snug">{b.headline}</p>
          {b.bullets.length > 0 && (
            <ul className="mt-2 space-y-1.5 text-[13px] leading-snug">
              {b.bullets.map((x, i) => (
                <li key={i} className="flex gap-2">
                  <Link href={`/research/${x.ticker}`} className="shrink-0 rounded-md bg-hero-ink/15 px-1.5 py-[1px] text-[11.5px] font-extrabold">
                    {x.ticker}
                  </Link>
                  <span>{x.text}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2.5 text-[11px] opacity-75">
            {b.quiet} holdings had nothing material. Written from {b.items} pre-scored items{b.model ? ` by ${b.model}` : ""}
            {b.cached ? ", from cache" : ""}.
          </p>
        </>
      )}
    </section>
  );
}
