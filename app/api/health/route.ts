// What this deployment can see. Variable names only, never values.
import { NextResponse } from "next/server";
import { botEnabled, botUsername } from "@/lib/telegram/bot";
import { kv, kvEnabled, kvEnvNames, kvPing } from "@/lib/kv";
import { hasLLM } from "@/lib/llm/router";

export const dynamic = "force-dynamic";

export async function GET() {
  let bot: string | null = null;
  let botError: string | null = null;
  try {
    bot = await botUsername();
  } catch (e) {
    botError = (e as Error).message;
  }
  return NextResponse.json({
    gemini: hasLLM(),
    telegram: { tokenPresent: botEnabled(), bot, error: botError },
    store: { configured: kvEnabled(), ping: await kvPing(), keys: await kv<number>("DBSIZE").catch(() => null), variables: kvEnvNames() },
    deployedAt: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  });
}
