// Shared types for FINN. Kept in one place so the pipeline (Node scripts),
// the API routes and the UI all speak the same shapes.

export type Category =
  | "results"
  | "mna"
  | "fund_raise"
  | "management_change"
  | "litigation"
  | "insider_trading"
  | "earnings_call"
  | "investor_meetings"
  | "credit_rating"
  | "dividend"
  | "bonus_split"
  | "capex"
  | "press_release"
  | "postal_ballot"
  | "agm_egm"
  | "pledging"
  | "unclassified";

export type Tier = "material" | "notable" | "routine";

export interface Holding {
  ticker: string; // NSE symbol
  name: string;
  sector: string;
  size: "Large" | "Mid" | "Small";
  qty?: number; // mock position size, for portfolio value and day P&L
  bse?: number; // resolved from Screener and cached
}

/** One headline number in the results card, in ₹ crore. */
export interface Triplet {
  cur: number | null;
  prevQ: number | null;
  prevY: number | null;
}

export interface ResultsCard {
  kind: "results";
  period: string; // e.g. "Q2 FY27 (Sep 2026)"
  basis: "consolidated" | "standalone";
  isLender: boolean; // banks/NBFCs: EBITDA is replaced by pre-provision profit
  revenue: Triplet;
  ebitda: Triplet;
  pbt: Triplet;
  pat: Triplet;
  ebitdaLabel: string; // "EBITDA" or "Pre-provision op. profit"
  exceptional?: string | null; // one line if an exceptional item distorts PAT
  verdict: string; // one line, numbers-only take
  check?: { source: "screener"; agrees: boolean; note: string };
  extractedBy?: string; // model that read the filing
}

export interface PersonBio {
  name: string;
  role: string;
  change: "appointed" | "resigned" | "retired" | "redesignated" | "other";
  effective?: string | null;
  bio?: string | null; // 1–2 lines on background
  previously?: string[]; // past roles, most recent first
  sources?: { title: string; url: string }[];
}

export interface MgmtCard {
  kind: "management";
  people: PersonBio[];
  reason?: string | null;
}

export interface SummaryCard {
  kind: "summary";
  line: string; // one-line "why you should care"
}

export type Enrichment = ResultsCard | MgmtCard | SummaryCard;

export interface Filing {
  id: string;
  ticker: string;
  company: string;
  ts: string; // ISO with +05:30
  title: string; // exchange subject line
  headline: string; // company-provided gist
  bseCategory: string;
  bseSub: string;
  critical: boolean;
  pdf: string | null;
  category: Category;
  tier: Tier;
  score: number; // 0–100 materiality
  reason: string; // why this score, shown on long-press
  classifiedBy: "rules" | "llm";
  enrichment?: Enrichment;
}

export interface Bar {
  d: string; // YYYY-MM-DD
  c: number; // close
  v: number; // volume
}

export interface PriceSeries {
  ticker: string;
  bars: Bar[]; // oldest first, ~6 months
}

export interface EngineStats {
  generatedAt: string;
  filings: number;
  byRules: number;
  byLLM: number;
  enriched: number;
  llmCalls: number;
  cacheHits: number;
  tokensIn: number;
  tokensOut: number;
  estCostUSD: number; // what this run would cost on paid tiers
  models: Record<string, number>; // model -> calls
  errors: string[];
}

export interface Digest {
  portfolio: Holding[];
  filings: Filing[]; // last 30 days, newest first
  prices: PriceSeries[];
  engine: EngineStats;
}
