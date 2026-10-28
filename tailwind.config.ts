import type { Config } from "tailwindcss";

const c = (v: string) => `rgb(var(--${v}) / <alpha-value>)`;

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: c("paper"),
        sheet: c("sheet"),
        raise: c("raise"),
        ink: c("ink"),
        dim: c("dim"),
        rule: c("rule"),
        brand: c("brand"),
        "brand-ink": c("brand-ink"),
        "brand-soft": c("brand-soft"),
        hero: c("hero"),
        "hero-ink": c("hero-ink"),
        up: c("up"),
        down: c("down"),
        flag: c("flag"),
        // legacy names used by older components
        marigold: c("flag"),
        slate: c("brand"),
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
