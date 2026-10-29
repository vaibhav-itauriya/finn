// "Ask FINN" from the app: typed or spoken questions. Audio is accepted as a fallback for browsers
// without built-in speech recognition (the model transcribes and answers in one call).
import { NextResponse } from "next/server";
import { ask } from "@/lib/copilot";
import { hasLLM } from "@/lib/llm/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function POST(req: Request) {
  if (!hasLLM()) return NextResponse.json({ error: "The model isn't configured on the server" }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as Parameters<typeof ask>[0];
  if (!b.q?.trim() && !b.audio?.data) return NextResponse.json({ error: "Ask something" }, { status: 400 });
  if (b.audio && b.audio.data.length > 4_000_000) return NextResponse.json({ error: "That recording is too long. Keep it under a minute." }, { status: 413 });
  try {
    return NextResponse.json(await ask(b));
  } catch (e) {
    return NextResponse.json({ error: /quota|rate|available/i.test((e as Error).message) ? "FINN's free model quota is busy. Try again in a minute." : (e as Error).message.slice(0, 200) }, { status: 502 });
  }
}
