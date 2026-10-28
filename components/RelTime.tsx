"use client";
import { useEffect, useState } from "react";
import { istTime, relTime } from "@/lib/client/format";

/** "3h ago" needs the viewer's clock, so the static HTML shows the IST time and the browser swaps in the relative one. */
export function RelTime({ iso, withTime }: { iso: string; withTime?: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  if (now == null) return <>{istTime(iso)}</>;
  const r = relTime(iso, now);
  return <>{withTime && !r.endsWith("ago") ? `${r}, ${istTime(iso)}` : r}</>;
}
