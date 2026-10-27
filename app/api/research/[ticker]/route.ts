// On-demand research API. One step per request so the UI can show sections as they land and
// every request stays well inside serverless limits:
//   ?step=numbers          Screener tables -> computed sections (no LLM)
//   ?step=call&i=0..3      read one concall transcript (cheap model, cached forever)
//   ?step=ledger           promise vs delivery (stronger model, on compact inputs)
//   ?step=thesis           business + bull/bear (stronger model)
//   ?step=ask&q=...        question over the transcripts (cheap model + keyword retrieval)
//   ?step=snapshot         precomputed report for demo companies, if present
import { NextResponse } from "next/server";
import { ask, snapshot, stepCall, stepLedger, stepNumbers, stepThesis } from "@/lib/pull/research";
import { hasLLM, meter } from "@/lib/llm/router";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await ctx.params;
  const ticker = decodeURIComponent(raw).toUpperCase().replace(/[^A-Z0-9&\-]/g, "");
  const url = new URL(req.url);
  const step = url.searchParams.get("step") || "numbers";
  const before = { calls: meter.calls, usd: meter.usd };
  try {
    let body: unknown;
    if (step === "snapshot") body = await snapshot(ticker);
    else if (step === "numbers") body = await stepNumbers(ticker);
    else {
      if (!hasLLM()) return NextResponse.json({ error: "GEMINI_API_KEY is not configured on the server" }, { status: 503 });
      if (step === "call") body = await stepCall(ticker, Number(url.searchParams.get("i") || 0));
      else if (step === "ledger") body = await stepLedger(ticker);
      else if (step === "thesis") body = await stepThesis(ticker);
      else if (step === "ask") body = await ask(ticker, (url.searchParams.get("q") || "").slice(0, 300));
      else return NextResponse.json({ error: `unknown step ${step}` }, { status: 400 });
    }
    return NextResponse.json(
      { data: body, cost: { calls: meter.calls - before.calls, usd: meter.usd - before.usd } },
      { headers: { "Cache-Control": step === "ask" ? "no-store" : "s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (e) {
    const msg = (e as Error).message || "failed";
    const status = /HTTP 404/.test(msg) ? 404 : 502;
    return NextResponse.json({ error: status === 404 ? `Couldn't find ${ticker} on Screener. Check the NSE symbol.` : msg.slice(0, 300) }, { status });
  }
}
