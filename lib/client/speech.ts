"use client";
// Thin wrappers over the browser's own speech: recognition (Chrome, Edge, Safari) and synthesis
// (everywhere). Where recognition is missing we record audio and let the server transcribe it.
import { useEffect, useState } from "react";

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

export function speak(text: string, lang = "en-IN", onEnd?: () => void) {
  if (typeof window === "undefined" || !window.speechSynthesis) return onEnd?.();
  window.speechSynthesis.cancel();
  if (!voices.length) loadVoices();
  const u = new SpeechSynthesisUtterance(text.replace(/₹/g, "rupees ").replace(/\bCr\b/g, "crore").replace(/×/g, " times"));
  u.lang = lang;
  const v =
    voices.find((x) => x.lang === lang && /Google|Neural|Natural/i.test(x.name)) ||
    voices.find((x) => x.lang === lang) ||
    voices.find((x) => x.lang.startsWith(lang.slice(0, 2)) && /India|IN/.test(x.lang + x.name)) ||
    voices.find((x) => x.lang.startsWith(lang.slice(0, 2)));
  if (v) u.voice = v;
  u.rate = 1.04;
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
