// Stage 1 of the push funnel: deterministic classification + materiality scoring.
// Exchange metadata (BSE category / sub-category / subject) already says what most filings are,
// so rules handle the bulk for free. Only filings the rules can't place go to the cheap LLM.
import type { Category, Tier } from "../types";

export interface RuleHit {
  category: Category;
  score: number;
  reason: string;
}

interface Rule {
  re: RegExp;
  category: Category;
  score: number;
  reason: string;
  /** Match only exchange category/sub-category/subject, not the company's free-text gist (gists mention "results" loosely). */
  subjectOnly?: boolean;
  /** Optional refinement on the matched text (e.g. bump KMP changes, demote secretaries). */
  adjust?: (text: string) => { score: number; reason?: string } | null;
}

const KMP = /\b(chief executive|ceo|managing director|\bmd\b|chief financial|cfo|chairman|chairperson|whole[- ]time director|executive director|president|coo|chief operating)\b/i;
const MINOR_OFFICER = /\b(company secretary|compliance officer|independent director|nominee director|senior management personnel|smp|auditor|scrutini[sz]er|registrar)\b/i;

// Ordered: the first match wins, so specific patterns come before generic ones.
const RULES: Rule[] = [
  // ---- routine paperwork first, so "Board Meeting Intimation for results" doesn't look like results
  { re: /trading window/i, category: "unclassified", score: 3, reason: "Trading-window closure is routine compliance" },
  { re: /(74\s*\(5\)|depositories and participants|reg(ulation)?\.?\s*74)/i, category: "unclassified", score: 2, reason: "Depository compliance certificate" },
  { re: /(newspaper (publication|clipping)|copy of newspaper|publication of (financial )?results|advertisement)/i, category: "unclassified", score: 8, reason: "Newspaper copy of something already filed", adjust: (t) => (/result/i.test(t) ? { score: 8, reason: "Newspaper ad of results already filed" } : null) },
  { re: /listing of (equity )?shares|listing (and|&) trading|commencement of trading/i, category: "fund_raise", score: 80, reason: "Listing of a subsidiary or new shares", subjectOnly: true },
  { re: /(allotment of (esop|esos|esps|equity shares under esop)|esop|employee stock option|grant of (stock )?options|restricted stock unit|\brsus?\b|stock appreciation rights)/i, category: "unclassified", score: 6, reason: "Employee stock options, tiny dilution" },
  { re: /(production volume|sales volume|business update|operational update|operational performance|production and off-?take|e-?auction data|monthly (sales|update)|vehicle sales|auto sales|provisional (production|business))/i, category: "press_release", score: 42, reason: "Monthly operating data: a read on the quarter before results" },
  { re: /(loss of share certificate|duplicate share certificate|issue of duplicate)/i, category: "unclassified", score: 2, reason: "Investor-servicing paperwork" },
  { re: /(certificate under reg|compliance certificate|reconciliation of share capital|statement of investor complaints|investor grievance)/i, category: "unclassified", score: 3, reason: "Periodic compliance filing" },
  { re: /(monitoring agency|investor education and protection|\biepf\b|half yearly report|memorandum (&|and) articles|change in (registered office|rta|registrar)|loss of certificate)/i, category: "unclassified", score: 6, reason: "Routine regulatory paperwork" },
  { re: /(business responsibility|brsr|esg|sustainability report)/i, category: "unclassified", score: 8, reason: "ESG/BRSR disclosure" },
  { re: /(closure of register|book closure)/i, category: "dividend", score: 15, reason: "Book closure (usually for a dividend already known)" },

  // ---- earnings call before results, because transcripts mention "results"
  { re: /(earnings call transcript|transcript of (the )?(earnings|conference|analyst)|concall transcript)/i, category: "earnings_call", score: 40, reason: "Transcript is out: fresh guidance to read" },
  { re: /(audio recording|recording of (the )?(earnings|conference|analyst)|audio\/video|webcast link)/i, category: "earnings_call", score: 12, reason: "Recording link only" },
  { re: /(earnings call|conference call|concall|analyst call)/i, category: "earnings_call", score: 18, reason: "Earnings-call scheduling" },
  { re: /(analyst(\(s\))? ?\/ ?investor(\(s\))? meet|investor meet|analyst meet|institutional investor|non[- ]deal roadshow|investor conference)/i, category: "investor_meetings", score: 10, reason: "Investor meeting schedule, no new numbers" },
  { re: /(investor presentation|earnings presentation|analyst presentation|shareholders?'? letter|fact ?sheet)/i, category: "results", score: 45, reason: "Management's own framing of the quarter" },

  // ---- results
  { re: /board meeting intimation|intimation of board meeting|prior intimation/i, category: "results", score: 20, reason: "Date set for a board meeting", adjust: (t) => (/result/i.test(t) ? { score: 28, reason: "Results date announced" } : null) },
  { re: /(financial results|unaudited.*results|audited.*results|results for the (quarter|year)|outcome of board meeting.*result|integrated filing \(financial\))/i, category: "results", score: 92, reason: "Quarterly results filed", subjectOnly: true },
  { re: /^result\b|\|\s*result\s*\|/i, category: "results", score: 88, reason: "Results category" },
  { re: /outcome of (the )?board meeting.*(financial|result)/i, category: "results", score: 90, reason: "Board approved the quarter's results" },
  { re: /financial statements for the (quarter|half|year)|interim condensed/i, category: "results", score: 50, reason: "Detailed financial statements for the quarter" },

  // ---- corporate actions with money attached
  { re: /\b(buy[- ]?back)\b/i, category: "fund_raise", score: 80, reason: "Buyback: capital returned to shareholders" },
  { re: /(qualified institution|\bqip\b|preferential (issue|allotment)|rights issue|initial public offer|\bipo\b|offer for sale|fund raising|raising of funds|capital raise)/i, category: "fund_raise", score: 74, reason: "Equity raise or listing: dilution or value unlock" },
  { re: /(non[- ]convertible|\bncds?\b|commercial paper|debentures?|bonds?\b|issue of securities)/i, category: "fund_raise", score: 38, reason: "Debt issuance" },
  { re: /allotment of equity shares|\| allotment\b/i, category: "fund_raise", score: 20, reason: "Share allotment (usually ESOPs or a raise already announced)", adjust: (t) => (/(warrant|preferential|qip|rights)/i.test(t) ? { score: 55, reason: "Shares allotted in a capital raise" } : null) },
  { re: /(bonus issue|issue of bonus|sub[- ]division|stock split|split of (equity )?shares)/i, category: "bonus_split", score: 55, reason: "Share count changes, no cash" },
  { re: /(interim dividend|final dividend|special dividend|declaration of dividend|record date)/i, category: "dividend", score: 40, reason: "Dividend / record date" },

  // ---- control and people
  { re: /(pledge|encumbrance|invocation)/i, category: "pledging", score: 70, reason: "Promoter pledge status changed" },
  { re: /(sast|takeover regulations|regulation 29|regulation 31|insider trading|regulation 7\(2\)|pit regulations)/i, category: "insider_trading", score: 35, reason: "Insider/promoter holding disclosure", adjust: (t) => (/promoter/i.test(t) ? { score: 55, reason: "Promoter changed their holding" } : null) },
  {
    re: /(change in (directorate|management|key managerial|kmp)|appointment of|resignation of|cessation|re-?appointment|retire(ment|s)|demise|steps down|redesignation)/i,
    category: "management_change",
    score: 50,
    reason: "Change at board/management level",
    adjust: (t) => {
      if (KMP.test(t)) return { score: /re-?appointment|continuation/i.test(t) ? 45 : 86, reason: "Top management (CEO/MD/CFO) change" };
      if (MINOR_OFFICER.test(t)) return { score: /auditor/i.test(t) ? 30 : 25, reason: "Secretarial/independent director change" };
      return null;
    },
  },

  { re: /(bagg(ed|ing)|receiving of order|receipt of order|award of order|order win|letter of award)/i, category: "press_release", score: 55, reason: "Order win" },

  // ---- deals, disputes, ratings, capex
  { re: /(takeover offer|open offer|disposal of (stake|shares)|sale of (stake|business|undertaking)|slump sale)/i, category: "mna", score: 76, reason: "Stake sale / takeover: changes what you own" },
  { re: /(demerger|amalgamation|scheme of arrangement|merger)/i, category: "mna", score: 85, reason: "Restructuring changes what you own" },
  { re: /(acquisition|acquire|joint venture|\bjv\b|stake sale|divest|disinvest|incorporation of (a )?(wholly owned )?subsidiar|investment in (wholly owned )?subsidiar|updates on acquisition)/i, category: "mna", score: 72, reason: "Acquisition / JV / stake change", adjust: (t) => (/incorporation of|investment in (wholly owned )?subsidiar/i.test(t) ? { score: 38, reason: "Capital put into a subsidiary" } : null) },
  { re: /(litigation|dispute|regulatory action|penalty|show cause|demand order|tax demand|gst|income tax|\bnclt\b|insolvency|sebi order|court|tribunal|arbitration|fine imposed|search and seizure|raid)/i, category: "litigation", score: 62, reason: "Legal or regulatory action", adjust: (t) => (/(insolvency|nclt|search and seizure|raid|sebi order)/i.test(t) ? { score: 82, reason: "Serious regulatory/insolvency matter" } : null) },
  { re: /credit rating|rating agency|\b(crisil|icra|care ratings|india ratings|fitch|moody|s&p)\b/i, category: "credit_rating", score: 24, reason: "Credit rating update", adjust: (t) => (/downgrad|negative|watch/i.test(t) ? { score: 78, reason: "Rating downgrade / negative watch" } : /upgrad/i.test(t) ? { score: 52, reason: "Rating upgrade" } : null) },
  { re: /(capacity expansion|capex|capital expenditure|new (plant|facility|unit)|greenfield|brownfield|commission(ing|ed) of)/i, category: "capex", score: 60, reason: "New capacity / capex" },

  // ---- meetings
  { re: /postal ballot/i, category: "postal_ballot", score: 14, reason: "Postal ballot", adjust: (t) => (/result|voting results/i.test(t) ? { score: 12, reason: "Postal ballot result" } : null) },
  { re: /(\bagm\b|\begm\b|annual general meeting|extra[- ]?ordinary general meeting|scrutinizer|voting results)/i, category: "agm_egm", score: 14, reason: "General meeting paperwork" },
  { re: /annual report/i, category: "unclassified", score: 22, reason: "Annual report filed (read in Research)" },

  // ---- news
  { re: /(order (win|received|inflow)|award of (order|contract)|receipt of (order|contract)|bagg(ed|ing)|receiving of order|letter of award|\bloa\b|contract worth)/i, category: "press_release", score: 55, reason: "Order win" },
  { re: /(clarification|rumou?r|news item|media report|media statement|statement of the company|spurt in volume|price movement)/i, category: "press_release", score: 45, reason: "Exchange asked for a clarification" },
  { re: /(press release|media release|launch|partnership|collaboration|mou|memorandum of understanding)/i, category: "press_release", score: 28, reason: "Company news / press release" },
];

export function classifyByRules(fields: { cat: string; sub: string; subject: string; headline: string; critical: boolean }): RuleHit | null {
  const text = `${fields.cat} | ${fields.sub} | ${fields.subject} | ${fields.headline}`.replace(/_/g, " ");
  const head = `${fields.cat} | ${fields.sub} | ${fields.subject}`.replace(/_/g, " ");
  for (const r of RULES) {
    if (!r.re.test(r.subjectOnly ? head : text)) continue;
    let score = r.score;
    let reason = r.reason;
    const adj = r.adjust?.(text);
    if (adj) {
      score = adj.score;
      reason = adj.reason || reason;
    }
    // BSE flags some filings as "critical news"; treat that as a nudge, not a verdict.
    if (fields.critical) score = Math.min(100, score + 6);
    return { category: r.category, score, reason };
  }
  // Category-only fallbacks from BSE's own taxonomy.
  if (/^Result$/i.test(fields.cat)) return { category: "results", score: 85, reason: "Results category" };
  if (/AGM\/EGM/i.test(fields.cat)) return { category: "agm_egm", score: 14, reason: "General meeting paperwork" };
  if (/Insider Trading/i.test(fields.cat)) return { category: "insider_trading", score: 35, reason: "Insider/SAST disclosure" };
  if (/Corp\.? Action/i.test(fields.cat)) return { category: "dividend", score: 35, reason: "Corporate action" };
  return null; // let the LLM decide
}

export function tierOf(score: number): Tier {
  if (score >= 65) return "material";
  if (score >= 35) return "notable";
  return "routine";
}

export const CATEGORY_LABEL: Record<Category, string> = {
  results: "Results",
  mna: "M&A",
  fund_raise: "Fund raise",
  management_change: "Management",
  litigation: "Litigation",
  insider_trading: "Insider",
  earnings_call: "Earnings call",
  investor_meetings: "Investor meet",
  credit_rating: "Credit rating",
  dividend: "Dividend",
  bonus_split: "Bonus/split",
  capex: "Capex",
  press_release: "News",
  postal_ballot: "Postal ballot",
  agm_egm: "AGM/EGM",
  pledging: "Pledging",
  unclassified: "Routine",
};

/** Base materiality per category, used when the LLM classifies a filing. */
export const BASE_SCORE: Record<Category, number> = {
  results: 88,
  mna: 75,
  fund_raise: 72,
  management_change: 60,
  litigation: 62,
  insider_trading: 40,
  earnings_call: 25,
  investor_meetings: 10,
  credit_rating: 40,
  dividend: 38,
  bonus_split: 55,
  capex: 60,
  press_release: 35,
  postal_ballot: 12,
  agm_egm: 14,
  pledging: 70,
  unclassified: 5,
};
