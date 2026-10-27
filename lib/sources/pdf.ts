// Fetch primary-document PDFs (exchange filings, transcripts, annual reports) and extract text.
import { extractText, getDocumentProxy } from "unpdf";
import { getBytes } from "../util/http";
import { BSE_PDF_HEADERS, pdfDirectUrls } from "./bse";

function isPdf(b: Uint8Array) {
  return b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
}

/** Download a PDF from BSE / Screener / company IR links, trying direct BSE paths when possible. */
export async function fetchPdf(url: string): Promise<Uint8Array> {
  const candidates: string[] = [];
  const m = url.match(/Pname=([^&]+\.pdf)/i) || url.match(/corpfiling\/Attach(?:Live|His)\/([^?]+\.pdf)/i);
  if (m) candidates.push(...pdfDirectUrls(m[1]));
  candidates.push(url);
  let lastErr: unknown;
  for (const c of candidates) {
    try {
      const headers = /bseindia\.com/.test(c) ? BSE_PDF_HEADERS : /screener\.in/.test(c) ? { Referer: "https://www.screener.in/" } : {};
      const b = await getBytes(c, { headers, retries: 1 });
      if (isPdf(b)) return b;
      lastErr = new Error(`Not a PDF at ${c}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Text per page (1-indexed in the returned array's position + 1). */
export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(doc, { mergePages: false });
  return (text as string[]).map((t) => t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim());
}
