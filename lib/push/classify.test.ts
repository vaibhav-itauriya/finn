// Real BSE subjects from the portfolio's October 2026 filings. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyByRules, tierOf } from "./classify";
import { toNum } from "./enrich";
import { bundle } from "../client/bundle";
import type { Filing } from "../types";

const c = (cat: string, sub: string, subject: string, headline = "") => classifyByRules({ cat, sub, subject, headline, critical: false });

test("results filings are material, the newspaper ad is not", () => {
  assert.equal(c("Result", "Financial Results", "Financial Results For The Quarter And Six-Month Period Ended September 30, 2026")?.category, "results");
  assert.equal(tierOf(c("Result", "Financial Results", "Un-Audited Financial Results For The Quarter Ended On 30Th September 2026")!.score), "material");
  assert.equal(tierOf(c("Company Update", "Newspaper Publication", "Newspaper Publication of results")!.score), "routine");
});

test("trading window and ESOP grants are folded away", () => {
  assert.equal(tierOf(c("Company Update", "Trading Window", "Closure of Trading Window")!.score), "routine");
  assert.equal(tierOf(c("Company Update", "General", "Grant Of Options To Eligible Employees Under RSU Plan 2022")!.score), "routine");
});

test("order wins are news, not M&A", () => {
  assert.equal(c("Company Update", "", "Announcement under Regulation 30 (LODR) - Bagging/receiving of order(s) or contract(s)")?.category, "press_release");
  assert.equal(c("Company Update", "Award of Order / Receipt of Order", "Award_of_Order_Receipt_of_Order")?.category, "press_release");
});

test("a CEO change outranks a company secretary change", () => {
  const ceo = c("Company Update", "Change in Directorate", "Appointment of Managing Director and Chief Executive Officer")!;
  const cs = c("Company Update", "Change in Management", "Resignation of Company Secretary and Compliance Officer")!;
  assert.equal(ceo.category, "management_change");
  assert.ok(ceo.score > 80 && cs.score < 35);
});

test("monthly operating data is notable, not results", () => {
  const r = c("Company Update", "General", "Maruti Suzuki Production Volume: September 2026")!;
  assert.equal(r.category, "press_release");
  assert.equal(tierOf(r.score), "notable");
});

test("rating downgrades jump the queue", () => {
  assert.equal(tierOf(c("Company Update", "Credit Rating", "Credit Rating", "CRISIL has downgraded the long term rating")!.score), "material");
  assert.equal(tierOf(c("Company Update", "Credit Rating", "Credit Rating", "ICRA reaffirmed")!.score), "routine");
});

test("model numbers are normalised", () => {
  assert.equal(toNum("1,234.5"), 1234.5);
  assert.equal(toNum("(12.3)"), -12.3);
  assert.equal(toNum("-"), null);
  assert.equal(toNum(42), 42);
});

test("a results day collapses into one item led by the enriched filing", () => {
  const base = { ticker: "MARUTI", company: "Maruti", headline: "", bseCategory: "Result", bseSub: "", critical: false, pdf: null, tier: "material" as const, reason: "", classifiedBy: "rules" as const };
  const fs: Filing[] = [
    { ...base, id: "a", ts: "2026-10-27T15:27:00+05:30", title: "Financial Results", category: "results", score: 92, enrichment: { kind: "summary", line: "x" } },
    { ...base, id: "b", ts: "2026-10-27T15:39:00+05:30", title: "Press Release", category: "results", score: 92 },
    { ...base, id: "c", ts: "2026-10-27T15:44:00+05:30", title: "Investor Presentation", category: "results", score: 45 },
  ];
  const b = bundle(fs);
  assert.equal(b.length, 1);
  assert.equal(b[0].lead.id, "a");
  assert.equal(b[0].related.length, 2);
});
