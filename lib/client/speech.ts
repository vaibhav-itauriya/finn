"use client";
// Thin wrappers over the browser's own speech: recognition (Chrome, Edge, Safari) and synthesis
// (everywhere). Where recognition is missing we record audio and let the server transcribe it.
import { useEffect, useState } from "react";
import { PORTFOLIO } from "@/config/portfolio";

type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export function recognizer(): Rec | null {
  if (typeof window === "undefined") return null;
  const C = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;
  return C ? new C() : null;
}

export const canRecord = () => typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia;

let voices: SpeechSynthesisVoice[] = [];
function loadVoices() {
  voices = window.speechSynthesis?.getVoices() || [];
}

// ---- Making text sound right when read aloud -------------------------------------------------

const NAMES: Record<string, string> = {
  ...Object.fromEntries(PORTFOLIO.map((h) => [h.ticker, h.name.replace(/\s*\(.*\)/, "")])),
  ASIANPAINT: "Asian Paints",
  KAYNES: "Kaynes Technology",
  DMART: "D Mart",
  TITAN: "Titan",
  OFSS: "Oracle Financial Services",
  KPITTECH: "K P I T Technologies",
};

// Order matters: longer and more specific first.
const TERMS: [RegExp, string][] = [
  [/\bEBITDA\b/gi, "ee-bit-dah"],
  [/\bPPOP\b/g, "pre-provision operating profit"],
  [/\bPAT\b/g, "profit after tax"],
  [/\bPBT\b/g, "profit before tax"],
  [/\bYoY\b|\by\/y\b/gi, "year on year"],
  [/\bQoQ\b|\bq\/q\b/gi, "quarter on quarter"],
  [/\bTTM\b/g, "trailing twelve months"],
  [/\bCAGR\b/g, "compound annual growth"],
  [/\bROCE\b/g, "R O C E"],
  [/\bROE\b/g, "R O E"],
  [/\bEPS\b/g, "E P S"],
  [/\bP\/E\b/g, "P E ratio"],
  [/\bD\/E\b/gi, "debt to equity"],
  [/\bbps\b/gi, "basis points"],
  [/\bM&A\b/g, "M and A"],
  [/\bMD\s*&\s*CEO\b/g, "M D and C E O"],
  [/\bNCLAT\b/g, "N C L A T"],
  [/\bAGM\b/g, "A G M"],
  [/\bQ([1-4])\s*FY\s*'?(\d{2})\b/g, "Q $1 of F Y $2"],
  [/\bFY\s*'?(\d{2})\b/g, "F Y $1"],
  [/\bH([12])\s*FY/g, "H $1 F Y"],
  [/&/g, " and "],
  [/×|(?<=\d)x\b/g, " times"],
  [/[—–]/g, ", "],
  [/·/g, ", "],
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "81,89,455" → 8189455 */
const num = (s: string) => Number(s.replace(/,/g, ""));
const trim = (x: number, d = 2) => String(Number(x.toFixed(d)));

/** A rupee amount the way people in India say it. */
function rupees(n: number, unit?: string): string {
  const u = (unit || "").toLowerCase();
  if (u.startsWith("cr")) return `${trim(n)} crore rupees`;
  if (u === "l" || u.startsWith("lakh") || u.startsWith("lac")) return `${trim(n)} lakh rupees`;
  if (n >= 1e7) return `${trim(n / 1e7)} crore rupees`;
  if (n >= 1e5) return `${trim(n / 1e5)} lakh rupees`;
  return `${trim(n)} rupees`;
}

export function speakable(text: string): string {
  let t = text;
  // Dates: 2026-10-28 → 28 October
  t = t.replace(/\b(20\d\d)-(\d\d)-(\d\d)\b/g, (_, _y, m, d) => `${Number(d)} ${MONTHS[Number(m) - 1]}`);
  // Signs first, so "−₹11,882" reads "minus 11882 rupees"
  t = t.replace(/[−-](?=\s?₹?\d)/g, (m, i) => (i === 0 || /[\s(:,]/.test(t[i - 1]) ? "minus " : m));
  t = t.replace(/\+(?=\s?₹?\d)/g, "plus ");
  // ₹ amounts with an optional unit
  const N = "(\\d{1,3}(?:,\\d{2,3})*(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)";
  t = t.replace(new RegExp(`₹\\s?${N}(?:\\s?(crore|cr|Cr|lakh|lac|L)\\b\\.?)?`, "g"), (_, n, u) => rupees(num(n), u));
  // Plain amounts in crore without the symbol
  t = t.replace(new RegExp(`${N}\\s?(?:cr|Cr)\\b\\.?`, "g"), (_, n) => `${trim(num(n))} crore`);
  t = t.replace(/\b(\d+)\s?y\b/g, (_, n) => `${n} year${n === "1" ? "" : "s"}`);
  // Big bare numbers with Indian commas
  t = t.replace(/\b\d{1,3}(?:,\d{2})+,\d{3}(?:\.\d+)?\b/g, (m) => {
    const n = num(m);
    return n >= 1e7 ? `${trim(n / 1e7)} crore` : n >= 1e5 ? `${trim(n / 1e5)} lakh` : String(n);
  });
  t = t.replace(/(\d),(\d{3})\b/g, "$1$2");
  t = t.replace(/(\d)\s?%/g, "$1 percent");
  for (const [re, to] of TERMS) t = t.replace(re, to);
  // Tickers → company names
  t = t.replace(/\b[A-Z][A-Z&-]{2,}\b/g, (w) => NAMES[w] ?? w);
  return t.replace(/\s+([,.;])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

export function hasVoice(lang: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return false;
  if (!voices.length) loadVoices();
  return voices.some((v) => v.lang.replace("_", "-").toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
}

export function speak(text: string, lang = "en-IN", onEnd?: () => void) {
  if (typeof window === "undefined" || !window.speechSynthesis) return onEnd?.();
  window.speechSynthesis.cancel();
  if (!voices.length) loadVoices();
  const u = new SpeechSynthesisUtterance(speakable(text));
  u.lang = lang;
  const norm = (l: string) => l.replace("_", "-");
  const v =
    voices.find((x) => norm(x.lang) === lang && /Google|Neural|Natural|Enhanced/i.test(x.name)) ||
    voices.find((x) => norm(x.lang) === lang) ||
    voices.find((x) => norm(x.lang).startsWith(lang.slice(0, 2)) && /IN|India/i.test(x.lang + x.name)) ||
    voices.find((x) => norm(x.lang).startsWith(lang.slice(0, 2)));
  if (v) u.voice = v;
  u.rate = 0.98;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

/** True while the browser is reading something aloud. */
export function useSpeaking() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!window.speechSynthesis) return;
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    const t = setInterval(() => setOn(window.speechSynthesis.speaking), 300);
    return () => clearInterval(t);
  }, []);
  return on;
}

/** Record up to `maxMs` of audio; resolves with base64 and its mime type. */
export async function recordAudio(maxMs = 20000, stopSignal: { stop?: () => void }) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<{ data: string; mime: string }>((res) => {
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      res({ data: btoa(bin), mime: (blob.type || "audio/webm").split(";")[0] });
    };
  });
  rec.start();
  const t = setTimeout(() => rec.state !== "inactive" && rec.stop(), maxMs);
  stopSignal.stop = () => {
    clearTimeout(t);
    if (rec.state !== "inactive") rec.stop();
  };
  return done;
}
