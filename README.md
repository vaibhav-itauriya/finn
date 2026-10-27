# FINN

A mobile-first investment agent for a portfolio manager who has ninety seconds between meetings.

FINN does two things.

**Today (push).** Every filing your 18 holdings made on BSE, plus their end-of-day price and volume, read and triaged into an inbox you can finish. Three to five things need you. The rest is folded. Results show up as Revenue, EBITDA, PBT and PAT against last quarter and last year, read from the actual results PDF. A CEO change shows who the new person is. A stock that moved more than *your* threshold shows up next to them. Swipe right when you're done, left to mute that kind of filing for that company. When it's empty, it says so.

**Research (pull).** Type any NSE company. FINN reads its last four earnings-call transcripts and checks what management promised against what the company later reported. Every claim links to the page it came from, and every management quote is string-matched against the PDF. The numbers sections (trajectory, balance sheet, cash quality) are computed in code, with no model in the loop.

## Why it looks like this

An investor doesn't lack information. They lack a way to stop reading. So the home screen is not a feed, it's a list with an end. The headline is a count ("3 things need you"), not a dashboard, because the first question every morning is "how much do I have to deal with?".

On the research side, summarising management is cheap and everyone does it. The useful question is whether management can be believed. So the first thing you see is "Kept 4 of 7 promises", and every row of the promise ledger opens to the quote and the number that settled it.

## Architecture

```
                    GitHub Actions (cron, after market close + every 3h)
                    ┌────────────────────────────────────────────────────┐
  BSE announcements │ 1. fetch    BSE filings · Yahoo EOD · Screener      │
  Yahoo chart API ──┤ 2. classify exchange-metadata rules (88% of filings) │
  Screener.in       │ 3. enrich   results PDF → line items → maths in code│
                    │             mgmt filing → who → grounded bio search │
                    │             everything else that might matter →     │
                    │             cheap model reads the PDF, ±25 on score │
                    │ 4. publish  data/digest.json  (+ Telegram push)     │
                    └───────────────┬────────────────────────────────────┘
                                    │ git commit → Vercel redeploy
                    ┌───────────────▼────────────────────────────────────┐
  Phone (PWA)  ◄────┤ Next.js on Vercel (Mumbai region)                  │
                    │  /          Today: bundles, windows, swipe, alerts  │
                    │  /rules     thresholds, re-evaluated in the browser │
                    │  /research  step API: numbers → calls → judgement   │
                    └────────────────────────────────────────────────────┘
```

### Model routing

| Step | Model | Why |
|---|---|---|
| Classify a filing | none (rules on BSE category, sub-category, subject) | Exchange metadata already says what most filings are. Free and deterministic. |
| Read a results PDF | Gemini Flash-Lite with an enforced JSON schema | Copying numbers from a table is extraction, not reasoning. EBITDA, margins and deltas are computed in code. |
| ...if that fails validation | Gemini Flash | Escalate only when revenue/PAT are missing or disagree with Screener. |
| Who is the new CFO | Gemini Flash with Google Search grounding | The only step that needs the open web. Sources are shown. |
| Second opinion on other filings | Flash-Lite reading the PDF | Writes one line of substance (or nothing), and can move the rules' score by at most 25 points. |
| Read a concall transcript | Flash-Lite | Map step. Output is small structured notes. Cached forever, transcripts don't change. |
| Promise ledger, bull/bear | Gemini Flash | Reduce step. Sees ~5k tokens of notes and numbers instead of ~150k of transcripts. |
| Financial sections | none | Screener tables parsed and turned into signals by code. |

Everything an LLM produces is cached by document (`data/cache`, committed by the pipeline), so the second run of the day costs close to nothing. The Today screen footer and `data/last-run.log` show calls, cache hits, tokens and what the run would cost on paid tiers.

### Guardrails against slop

- Results numbers are cross-checked against Screener's independently parsed table and the card says whether they agree.
- Every management quote in Research is searched for in the transcript text. The share found word for word is shown at the bottom of each report.
- Replies that are not valid JSON are retried, never cached.
- Pull side uses primary documents only: the company's transcripts and its reported financials.

## Data sources

- **Filings:** BSE's announcement API (the same one bseindia.com uses). BSE rather than NSE because NSE blocks cloud IPs.
- **Prices:** Yahoo Finance chart API (`TICKER.NS`), end of day.
- **Fundamentals and document links:** Screener.in company pages (financial tables, concall transcript links, results PDFs).

## Running it

```bash
npm install
GEMINI_API_KEY=... npx tsx scripts/run-push.ts           # builds data/digest.json
GEMINI_API_KEY=... npx tsx scripts/run-research.ts KAYNES # precomputes a research report
GEMINI_API_KEY=... npm run dev
```

Deploy: import the repo on Vercel and set `GEMINI_API_KEY`. In GitHub, set the same secret for Actions. Optional: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` secrets and a `FINN_APP_URL` variable to get pushes on your phone. Optional: `UPSTASH_REDIS_REST_URL/TOKEN` to share the research cache across serverless instances.

The portfolio is `config/portfolio.ts`. Only NSE symbols are listed; BSE codes are resolved from Screener at run time.
