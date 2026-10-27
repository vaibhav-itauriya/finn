import type { Holding } from "../lib/types";

// Mock portfolio: 18 names across 14 sectors, large and mid caps, one lender-heavy pocket
// (banks/NBFCs report differently, which stress-tests the results card) and a few
// high-beta mid caps that throw off price/volume alerts.
// Only NSE tickers are hard-coded. BSE codes are resolved from Screener at run time,
// so adding any company here is a one-line change.
export const PORTFOLIO: Holding[] = [
  { ticker: "RELIANCE", name: "Reliance Industries", sector: "Conglomerate", size: "Large" },
  { ticker: "HDFCBANK", name: "HDFC Bank", sector: "Bank", size: "Large" },
  { ticker: "TCS", name: "Tata Consultancy Services", sector: "IT services", size: "Large" },
  { ticker: "BHARTIARTL", name: "Bharti Airtel", sector: "Telecom", size: "Large" },
  { ticker: "LT", name: "Larsen & Toubro", sector: "Capital goods", size: "Large" },
  { ticker: "ITC", name: "ITC", sector: "FMCG", size: "Large" },
  { ticker: "SUNPHARMA", name: "Sun Pharma", sector: "Pharma", size: "Large" },
  { ticker: "MARUTI", name: "Maruti Suzuki", sector: "Auto", size: "Large" },
  { ticker: "BAJFINANCE", name: "Bajaj Finance", sector: "NBFC", size: "Large" },
  { ticker: "ETERNAL", name: "Eternal (Zomato)", sector: "Internet", size: "Large" },
  { ticker: "TRENT", name: "Trent", sector: "Retail", size: "Large" },
  { ticker: "HAL", name: "Hindustan Aeronautics", sector: "Defence", size: "Large" },
  { ticker: "COALINDIA", name: "Coal India", sector: "Mining (PSU)", size: "Large" },
  { ticker: "DIXON", name: "Dixon Technologies", sector: "Electronics mfg", size: "Mid" },
  { ticker: "POLYCAB", name: "Polycab India", sector: "Cables", size: "Mid" },
  { ticker: "PERSISTENT", name: "Persistent Systems", sector: "IT services", size: "Mid" },
  { ticker: "KPITTECH", name: "KPIT Technologies", sector: "Auto software", size: "Mid" },
  { ticker: "DEEPAKNTR", name: "Deepak Nitrite", sector: "Chemicals", size: "Mid" },
];

// Companies for the on-demand research demo (outside the portfolio on purpose).
// The research engine is not limited to these: any ticker Screener covers works.
export const RESEARCH_DEMO = ["ASIANPAINT", "KAYNES", "DMART", "TITAN"];
