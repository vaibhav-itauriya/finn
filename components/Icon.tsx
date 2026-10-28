// One small stroke icon set so every icon shares weight and corner style.
export type IconName =
  | "home"
  | "inbox"
  | "pie"
  | "lens"
  | "bell"
  | "bolt"
  | "doc"
  | "dial"
  | "send"
  | "sun"
  | "moon"
  | "chev"
  | "spark"
  | "check"
  | "x"
  | "telegram";

const P: Record<IconName, React.ReactNode> = {
  home: <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z" />,
  inbox: (
    <>
      <path d="M3.5 13 6 5.8A1.5 1.5 0 0 1 7.4 4.8h9.2a1.5 1.5 0 0 1 1.4 1L20.5 13v5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18v-5Z" />
      <path d="M3.5 13H8l1.5 2.5h5L16 13h4.5" />
    </>
  ),
  pie: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12V3.5Z" />
      <path d="M15 3.9A8.5 8.5 0 0 1 20.1 9H15V3.9Z" />
    </>
  ),
  lens: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2Z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  bolt: <path d="M13 3 5 13.5h6L10 21l9-11h-6.5L13 3Z" />,
  doc: (
    <>
      <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7.5 3.5Z" />
      <path d="M13.5 3.5V8H18M9 12.5h6M9 16h6" />
    </>
  ),
  dial: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  send: <path d="m4 11.5 15.5-7-5 15.5-3-6.5-7.5-2Z M11.5 13.5l8-9" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />,
  chev: <path d="m9 5 7 7-7 7" />,
  spark: <path d="M12 3.5 13.8 10l6.7 2-6.7 2L12 20.5 10.2 14l-6.7-2 6.7-2L12 3.5Z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  telegram: <path d="M20.5 4.5 3.8 11.1c-.9.4-.9 1.1 0 1.4l4.2 1.3 1.6 5c.2.6.6.7 1 .3l2.4-2.1 4.4 3.2c.7.4 1.2.2 1.4-.7l2.7-12.8c.3-1.1-.4-1.6-1-1.2ZM8.4 13.6l9.3-6-7.5 7.3" />,
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {P[name]}
    </svg>
  );
}
