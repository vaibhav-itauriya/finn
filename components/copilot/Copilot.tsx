"use client";
// Ask FINN: the mic in the middle of the tab bar, on every screen. Tap, speak (English or Hindi), and FINN answers aloud
// from the portfolio's own data, then offers the screen that shows the detail. Typing works too.
import { AnimatePresence, motion } from "framer-motion";
import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Icon } from "../Icon";
import { canRecord, recognizer, recordAudio, speak, stopSpeaking, useSpeaking } from "@/lib/client/speech";
import { screenContext } from "@/lib/client/screen";

interface Msg {
  role: "user" | "finn";
  text: string;
  path?: string | null;
  label?: string;
  error?: boolean;
}

const SUGGEST: Record<string, string[]> = {
  "en-IN": ["What needs me today?", "How did my portfolio do?", "Any unusual moves this week?", "Who is HDFC Bank's new CEO?", "Did Titan deliver on its guidance?", "Research Asian Paints"],
  "hi-IN": ["आज मेरे लिए क्या ज़रूरी है?", "मेरा पोर्टफोलियो कैसा रहा?", "इस हफ़्ते कोई असामान्य मूव?", "Titan ने अपनी guidance पूरी की?"],
};

const readRules = () => {
  try {
    return JSON.parse(localStorage.getItem("finn.rules") || "null");
  } catch {
    return null;
  }
};

export function Copilot() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [listening, setListening] = useState<"off" | "speech" | "record">("off");
  const [interim, setInterim] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [lang, setLang] = useState<"en-IN" | "hi-IN">("en-IN");
  const speaking = useSpeaking();
  const busyRef = useRef(false);
  const recRef = useRef<ReturnType<typeof recognizer>>(null);
  const stopRec = useRef<{ stop?: () => void }>({});
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setVoiceOn(localStorage.getItem("finn.voice") !== "off");
      const l = localStorage.getItem("finn.lang");
      if (l === "hi-IN") setLang("hi-IN");
    } catch {
      /* defaults */
    }
  }, []);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy, interim]);
  // Other screens can open the copilot with a question, e.g. the Home "Ask FINN" card.
  useEffect(() => {
    const on = (e: Event) => {
      setOpen(true);
      const q = (e as CustomEvent<string | undefined>).detail;
      if (q) setTimeout(() => sendRef.current(q), 50);
      else if (!msgsRef.current.length) setTimeout(() => listenRef.current(), 250); // one tap to talk
    };
    window.addEventListener("finn-ask", on);
    return () => window.removeEventListener("finn-ask", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback(
    async (q: string, audio?: { data: string; mime: string }) => {
      if ((!q.trim() && !audio) || busyRef.current) return;
      busyRef.current = true;
      stopSpeaking();
      const history = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
      if (q) setMsgs((m) => [...m, { role: "user", text: q }]);
      setText("");
      setBusy(true);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 40000);
      try {
        const r = await fetch("/api/copilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q, audio, history, rules: readRules(), screen: screenContext(), page: window.location.pathname }),
          signal: ctrl.signal,
        });
        const j = await r.json().catch(() => ({ error: "FINN didn't answer in time. Try again in a moment." }));
        if (!r.ok) throw new Error(j.error || "Couldn't answer that");
        setMsgs((m) => [...(audio && j.heard ? [...m, { role: "user" as const, text: j.heard }] : m), { role: "finn", text: j.reply, path: j.path, label: j.label }]);
        if (voiceOn) speak(j.reply, j.lang);
        // "Open/show/take me to..." means go there now.
        const asked = (q || j.heard || "").toLowerCase();
        if (j.path && /^(open|show|go to|take me|research|खोलो|दिखाओ)/.test(asked.trim())) {
          setTimeout(() => {
            router.push(j.path);
          }, 900);
        }
      } catch (e) {
        const msg = (e as Error).name === "AbortError" ? "That took too long, the free model is busy. Try again in a moment." : (e as Error).message;
        setMsgs((m) => [...m, { role: "finn", text: msg, error: true }]);
      } finally {
        clearTimeout(timer);
        busyRef.current = false;
        setBusy(false);
      }
    },
    [msgs, voiceOn, router],
  );

  // Recognition callbacks outlive renders: always call the latest send.
  const sendRef = useRef(send);
  sendRef.current = send;
  const interimRef = useRef("");
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;

  const listen = useCallback(async () => {
    stopSpeaking();
    if (listening !== "off") {
      recRef.current?.stop();
      stopRec.current.stop?.();
      return;
    }
    const rec = recognizer();
    if (rec) {
      recRef.current = rec;
      rec.lang = lang;
      rec.interimResults = true;
      rec.continuous = false;
      let finalText = "";
      rec.onresult = (e) => {
        let t = "";
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        interimRef.current = t;
        setInterim(t);
        if (e.results[e.results.length - 1].isFinal) finalText = t;
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed") setMsgs((m) => [...m, { role: "finn", text: "Microphone access is blocked. Allow it in your browser, or type your question.", error: true }]);
      };
      rec.onend = () => {
        setListening("off");
        const q = (finalText || interimRef.current).trim();
        interimRef.current = "";
        setInterim("");
        if (q) sendRef.current(q);
      };
      setListening("speech");
      interimRef.current = "";
      rec.start();
      return;
    }
    if (canRecord()) {
      setListening("record");
      try {
        const audio = await recordAudio(20000, stopRec.current);
        setListening("off");
        sendRef.current("", audio);
      } catch {
        setListening("off");
        setMsgs((m) => [...m, { role: "finn", text: "Microphone access is blocked. Allow it in your browser, or type your question.", error: true }]);
      }
      return;
    }
    setMsgs((m) => [...m, { role: "finn", text: "This browser can't use the microphone. Type your question instead.", error: true }]);
  }, [listening, lang]);

  const listenRef = useRef(listen);
  listenRef.current = listen;
  const close = () => {
    setOpen(false);
    recRef.current?.abort();
    stopRec.current.stop?.();
    setListening("off");
    stopSpeaking();
  };
  const toggleVoice = () => {
    const v = !voiceOn;
    setVoiceOn(v);
    if (!v) stopSpeaking();
    try {
      localStorage.setItem("finn.voice", v ? "on" : "off");
    } catch {
      /* ignore */
    }
  };
  const toggleLang = () => {
    const l = lang === "en-IN" ? "hi-IN" : "en-IN";
    setLang(l);
    try {
      localStorage.setItem("finn.lang", l);
    } catch {
      /* ignore */
    }
  };

  if (pathname?.startsWith("/api")) return null;

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 bg-black/40" onClick={close} />
            <motion.section
              role="dialog"
              aria-label="Ask FINN"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
              className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[86dvh] max-w-[520px] flex-col rounded-t-[22px] bg-sheet pb-[env(safe-area-inset-bottom)] shadow-2xl"
            >
              <div className="flex items-center gap-2 px-4 pt-3">
                <span className="mx-auto mb-1 h-1 w-10 rounded-full bg-rule absolute left-1/2 -translate-x-1/2 top-2" aria-hidden />
                <h2 className="mt-2 text-[17px] font-extrabold tracking-tight">Ask FINN</h2>
                <button onClick={toggleLang} className="ml-auto mt-2 rounded-full bg-raise px-2.5 py-1 text-[12px] font-bold" aria-label="Switch language">
                  {lang === "en-IN" ? "EN" : "हिं"}
                </button>
                <button onClick={toggleVoice} className={clsx("mt-2 grid h-8 w-8 place-items-center rounded-full", voiceOn ? "bg-brand-soft text-brand" : "bg-raise text-dim")} aria-label={voiceOn ? "Mute spoken answers" : "Speak answers aloud"} aria-pressed={voiceOn}>
                  <Icon name="speaker" size={16} />
                </button>
                <button onClick={close} className="mt-2 grid h-8 w-8 place-items-center rounded-full bg-raise" aria-label="Close">
                  <Icon name="x" size={16} />
                </button>
              </div>

              <div ref={listRef} className="min-h-[180px] flex-1 overflow-y-auto px-4 pb-2 pt-3">
                {msgs.length === 0 && listening === "off" && !busy && (
                  <>
                    <p className="text-[13px] leading-snug text-dim">Ask about your holdings, today&apos;s filings, unusual moves, or any company&apos;s promises. FINN answers from its own data and reads the answer aloud.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {SUGGEST[lang].map((s) => (
                        <button key={s} onClick={() => send(s)} className="rounded-full bg-raise px-3 py-1.5 text-left text-[12.5px] font-semibold">
                          {s}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <ul className="space-y-2.5">
                  {msgs.map((m, i) => (
                    <li key={i} className={clsx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                      <div
                        className={clsx(
                          "max-w-[86%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-snug",
                          m.role === "user" ? "rounded-br-md bg-brand text-brand-ink" : m.error ? "rounded-bl-md bg-down/10 text-down" : "rounded-bl-md bg-raise",
                        )}
                      >
                        {m.text}
                        {m.role === "finn" && !m.error && (
                          <div className="mt-2 flex items-center gap-3">
                            {m.path && (
                              <button onClick={() => { close(); router.push(m.path!); }} className="rounded-full bg-brand px-3 py-1 text-[12px] font-bold text-brand-ink">
                                {m.label || "Open"} ›
                              </button>
                            )}
                            <button onClick={() => speak(m.text, /[ऀ-ॿ]/.test(m.text) ? "hi-IN" : "en-IN")} className="text-dim" aria-label="Read this aloud">
                              <Icon name="speaker" size={15} />
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                  {interim && (
                    <li className="flex justify-end">
                      <div className="max-w-[86%] rounded-2xl rounded-br-md bg-brand/60 px-3.5 py-2.5 text-[14px] text-brand-ink">{interim}…</div>
                    </li>
                  )}
                  {busy && (
                    <li className="flex">
                      <div className="flex gap-1 rounded-2xl rounded-bl-md bg-raise px-4 py-3.5" aria-label="FINN is thinking">
                        {[0, 1, 2].map((i) => (
                          <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-dim" style={{ animationDelay: `${i * 0.15}s` }} />
                        ))}
                      </div>
                    </li>
                  )}
                </ul>
              </div>

              <div className="flex items-center gap-2 border-t border-rule px-3 py-3">
                <form
                  className="flex min-w-0 flex-1 items-center rounded-full bg-raise pl-4 pr-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send(text);
                  }}
                >
                  <label htmlFor="ask-finn" className="sr-only">
                    Your question
                  </label>
                  <input
                    id="ask-finn"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={listening !== "off" ? "Listening…" : "Type or tap the mic"}
                    className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] outline-none"
                  />
                  {text.trim() && (
                    <button className="grid h-8 w-8 place-items-center rounded-full bg-brand text-brand-ink" aria-label="Send">
                      <Icon name="arrow" size={16} />
                    </button>
                  )}
                </form>
                <button
                  onClick={listen}
                  aria-label={listening !== "off" ? "Stop listening" : "Speak"}
                  className={clsx("relative grid h-12 w-12 shrink-0 place-items-center rounded-full", listening !== "off" ? "bg-down text-white" : "bg-brand text-brand-ink")}
                >
                  {listening !== "off" && <span className="absolute inset-0 animate-ping rounded-full bg-down/40" aria-hidden />}
                  <Icon name={listening !== "off" ? "stop" : "mic"} size={22} />
                </button>
              </div>
              {listening === "record" && <p className="-mt-1 pb-2 text-center text-[11.5px] text-dim">Recording. Tap stop when you&apos;re done.</p>}
              {speaking && (
                <button onClick={stopSpeaking} className="-mt-1 pb-2 text-center text-[11.5px] font-semibold text-brand">
                  Speaking. Tap to stop.
                </button>
              )}
            </motion.section>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

/** Open the copilot from anywhere, optionally with a question already asked. */
export const askFinn = (q?: string) => window.dispatchEvent(new CustomEvent("finn-ask", { detail: q }));
