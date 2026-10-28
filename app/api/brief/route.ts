import { NextResponse } from "next/server";
import { loadDigest } from "@/lib/data";
import { buildBrief } from "@/lib/push/brief";
import { hasLLM } from "@/lib/llm/router";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const hours = Math.min(720, Math.max(1, Number(new URL(req.url).searchParams.get("hours")) || 24));
  if (!hasLLM()) return NextResponse.json({ error: "GEMINI_API_KEY is not configured on the server" }, { status: 503 });
  const d = await loadDigest(70);
  if (!d) return NextResponse.json({ error: "No data yet" }, { status: 503 });
  try {
    return NextResponse.json({ data: await buildBrief(d, hours) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 502 });
  }
}
