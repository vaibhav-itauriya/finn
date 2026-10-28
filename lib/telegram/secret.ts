import { createHash } from "node:crypto";

/**
 * Shared secret between the scheduled pipeline (GitHub) and the app's broadcast endpoint (Vercel).
 * Both sides already hold the bot token, so by default the secret is derived from it and no extra
 * setting is needed. FINN_PUSH_SECRET overrides it if you want to rotate independently.
 */
export function pushSecret(): string {
  if (process.env.FINN_PUSH_SECRET) return process.env.FINN_PUSH_SECRET;
  const t = process.env.TELEGRAM_BOT_TOKEN;
  return t ? createHash("sha256").update(`finn-broadcast|${t}`).digest("hex") : "";
}
