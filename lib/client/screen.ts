"use client";
// What the user is looking at, in plain text, so "explain this" in Ask FINN answers about this
// screen (e.g. a research report computed live in the browser that the server never saw).
import { useEffect } from "react";

declare global {
  interface Window {
    __finnScreen?: { path: string; text: string };
  }
}

export function useScreenContext(text: string | null) {
  useEffect(() => {
    if (!text) return;
    window.__finnScreen = { path: window.location.pathname, text: text.slice(0, 8000) };
    return () => {
      if (window.__finnScreen?.text === text.slice(0, 8000)) window.__finnScreen = undefined;
    };
  }, [text]);
}

export const screenContext = () => (typeof window !== "undefined" && window.__finnScreen?.path === window.location.pathname ? window.__finnScreen.text : undefined);
