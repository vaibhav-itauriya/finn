// On-demand research API. One step per request so the UI can show sections as they land and
// every request stays well inside serverless limits:
//   ?step=numbers          Screener tables -> computed sections (no LLM)
//   ?step=call&i=0..3      read one concall transcript (cheap model, cached forever)
//   ?step=ledger           promise vs delivery (stronger model, on compact inputs)
//   ?step=thesis           business + bull/bear (stronger model)
//   ?step=ask&q=...        question over the transcripts (cheap model + keyword retrieval)
//   ?step=price            five years of daily closes for the share chart (Yahoo, Screener fallback)
//   ?step=snapshot         precomputed report for demo companies, if present
import { NextResponse } from "next/server";
import { ask, snapshot, stepCall, stepLedger, stepNumbers, stepPrice, stepThesis } from "@/lib/pull/research";
import { hasLLM, meter } from "@/lib/llm/router";
import type { CallExtract } from "@/lib/pull/calls";

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
    else if (step === "price") body = await stepPrice(ticker);
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
      { headers: { "Cache-Control": step === "ask" ? "no-store" : step === "price" ? "s-maxage=1800, stale-while-revalidate=7200" : "s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (e) {
    const msg = (e as Error).message || "failed";
    const status = /HTTP 404/.test(msg) ? 404 : 502;
    return NextResponse.json({ error: status === 404 ? `Couldn't find ${ticker} on Screener. Check the NSE symbol.` : msg.slice(0, 300) }, { status });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await ctx.params;
  const ticker = decodeURIComponent(raw).toUpperCase().replace(/[^A-Z0-9&\-]/g, "");
  const step = new URL(req.url).searchParams.get("step");
  if (!hasLLM()) return NextResponse.json({ error: "GEMINI_API_KEY is not configured on the server" }, { status: 503 });
  const before = { calls: meter.calls, usd: meter.usd };
  try {
    const { calls } = (await req.json()) as { calls: CallExtract[] };
    const clean = (calls || []).slice(0, 5);
    const body = step === "ledger" ? await stepLedger(ticker, clean) : step === "thesis" ? await stepThesis(ticker, clean) : null;
    if (!body) return NextResponse.json({ error: `unknown step ${step}` }, { status: 400 });
    return NextResponse.json({ data: body, cost: { calls: meter.calls - before.calls, usd: meter.usd - before.usd } });
  } catch (e) {
    return NextResponse.json({ error: ((e as Error).message || "failed").slice(0, 300) }, { status: 502 });
  }
}
