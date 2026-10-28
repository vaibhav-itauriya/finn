import type { Holding } from "../lib/types";

// Mock portfolio (quantities are made up, sized so no single name dominates): 18 names across 14 sectors, large and mid caps, one lender-heavy pocket
// (banks/NBFCs report differently, which stress-tests the results card) and a few
// high-beta mid caps that throw off price/volume alerts.
// Only NSE tickers are hard-coded. BSE codes are resolved from Screener at run time,
// so adding any company here is a one-line change.
export const PORTFOLIO: Holding[] = [
  { ticker: "RELIANCE", name: "Reliance Industries", sector: "Conglomerate", size: "Large", qty: 600 },
  { ticker: "HDFCBANK", name: "HDFC Bank", sector: "Bank", size: "Large", qty: 500 },
  { ticker: "TCS", name: "Tata Consultancy Services", sector: "IT services", size: "Large", qty: 250 },
  { ticker: "BHARTIARTL", name: "Bharti Airtel", sector: "Telecom", size: "Large", qty: 400 },
  { ticker: "LT", name: "Larsen & Toubro", sector: "Capital goods", size: "Large", qty: 180 },
  { ticker: "ITC", name: "ITC", sector: "FMCG", size: "Large", qty: 1500 },
  { ticker: "SUNPHARMA", name: "Sun Pharma", sector: "Pharma", size: "Large", qty: 350 },
  { ticker: "MARUTI", name: "Maruti Suzuki", sector: "Auto", size: "Large", qty: 40 },
  { ticker: "BAJFINANCE", name: "Bajaj Finance", sector: "NBFC", size: "Large", qty: 80 },
  { ticker: "ETERNAL", name: "Eternal (Zomato)", sector: "Internet", size: "Large", qty: 2000 },
  { ticker: "TRENT", name: "Trent", sector: "Retail", size: "Large", qty: 90 },
  { ticker: "HAL", name: "Hindustan Aeronautics", sector: "Defence", size: "Large", qty: 120 },
  { ticker: "COALINDIA", name: "Coal India", sector: "Mining (PSU)", size: "Large", qty: 1200 },
  { ticker: "DIXON", name: "Dixon Technologies", sector: "Electronics mfg", size: "Mid", qty: 30 },
  { ticker: "POLYCAB", name: "Polycab India", sector: "Cables", size: "Mid", qty: 60 },
  { ticker: "PERSISTENT", name: "Persistent Systems", sector: "IT services", size: "Mid", qty: 70 },
  { ticker: "KPITTECH", name: "KPIT Technologies", sector: "Auto software", size: "Mid", qty: 250 },
  { ticker: "DEEPAKNTR", name: "Deepak Nitrite", sector: "Chemicals", size: "Mid", qty: 150 },
];

// Companies for the on-demand research demo (outside the portfolio on purpose).
// The research engine is not limited to these: any ticker Screener covers works.
export const RESEARCH_DEMO = ["ASIANPAINT", "KAYNES", "DMART", "TITAN"];
