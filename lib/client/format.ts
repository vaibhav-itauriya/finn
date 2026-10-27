export const fmtPct = (x: number | null | undefined, d = 1) =>
  x == null || !Number.isFinite(x) ? "–" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}%`;

export const fmtCr = (x: number | null | undefined) => {
  if (x == null) return "–";
  const a = Math.abs(x);
  const s = a >= 1000 ? Math.round(a).toLocaleString("en-IN") : a >= 100 ? a.toFixed(0) : a.toFixed(1);
  return `${x < 0 ? "−" : ""}${s}`;
};

export const change = (a: number | null, b: number | null) => {
  if (a == null || b == null || b === 0) return null;
  if (b < 0) return a > 0 ? Infinity : ((a - b) / Math.abs(b)) * 100;
  return ((a - b) / b) * 100;
};

export function relTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  const m = Math.round((now - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

export const istTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export const istDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
