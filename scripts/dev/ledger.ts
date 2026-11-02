// Time the live research steps for one company: npx tsx scripts/dev/ledger.ts ITC
import { setLLMLogger, meter } from "../../lib/llm/router";
import { stepNumbers, stepCall, stepLedger, stepThesis } from "../../lib/pull/research";
import type { CallExtract } from "../../lib/pull/calls";
const t = process.argv[2] || "ITC";
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
setLLMLogger((s) => console.log(at(), "llm:", s));
(async () => {
  const { transcripts } = await stepNumbers(t);
  console.log(at(), "docs:", transcripts.map((x) => `${x.label}${x.kind ? "(ar)" : ""}`).join(", "));
  const calls: CallExtract[] = [];
  for (let i = 0; i < transcripts.length; i++) {
    try {
      const c = await stepCall(t, i);
      calls.push(c);
      console.log(at(), "read", c.quarter, "guidance", c.guidance.length);
    } catch (e) {
      console.log(at(), "call", i, "failed:", (e as Error).message.slice(0, 200));
    }
  }
  for (const [name, f] of [["ledger", () => stepLedger(t, calls)], ["thesis", () => stepThesis(t, calls)]] as const) {
    const s = Date.now();
    try {
      const r = await f();
      console.log(at(), name, "ok in", ((Date.now() - s) / 1000).toFixed(1), "s", JSON.stringify(r).slice(0, 200));
    } catch (e) {
      console.log(at(), name, "FAILED in", ((Date.now() - s) / 1000).toFixed(1), "s:", (e as Error).message.slice(0, 300));
    }
  }
  console.log("models", JSON.stringify(meter.models));
})();
