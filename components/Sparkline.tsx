export function Sparkline({ values, width = 72, height = 24, tone }: { values: number[]; width?: number; height?: number; tone?: "up" | "down" }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 1 - ((v - min) / span) * (height - 2)).toFixed(1)}`);
  const t = tone ?? (values[values.length - 1] >= values[0] ? "up" : "down");
  const last = pts[pts.length - 1].split(",");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <polyline points={pts.join(" ")} fill="none" stroke={`rgb(var(--${t}))`} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2" fill={`rgb(var(--${t}))`} />
    </svg>
  );
}

/** Tiny bar chart for multi-period numbers (revenue by year etc.). Negative bars hang below the axis. */
export function Bars({ values, labels, height = 64, highlightLast = true }: { values: (number | null)[]; labels: string[]; height?: number; highlightLast?: boolean }) {
  const vals = values.map((v) => v ?? 0);
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const span = max - min || 1;
  const zero = (max / span) * height;
  return (
    <div className="flex items-end gap-[3px]" style={{ height }} role="img" aria-label={labels.map((l, i) => `${l}: ${values[i] ?? "n/a"}`).join(", ")}>
      {vals.map((v, i) => {
        const h = Math.max(1, (Math.abs(v) / span) * height);
        const isLast = i === vals.length - 1 && highlightLast;
        return (
          <div key={i} className="flex-1 relative" style={{ height }}>
            <div
              className={isLast ? "absolute inset-x-0 rounded-[2px] bg-ink" : "absolute inset-x-0 rounded-[2px] bg-ink/25"}
              style={v >= 0 ? { bottom: height - zero, height: h } : { top: zero, height: h, background: "rgb(var(--down) / .6)" }}
            />
          </div>
        );
      })}
    </div>
  );
}
