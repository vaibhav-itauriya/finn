"use client";
import { useEffect } from "react";
import { registerSW } from "@/lib/client/push";

/** Registers the service worker so FINN can be installed and receive notifications. */
export function SWRegister() {
  useEffect(() => {
    registerSW()?.catch(() => {});
  }, []);
  return null;
}
