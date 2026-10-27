// BSE corporate announcements. We use BSE (not NSE) because its JSON API is reachable from
// cloud runners when sent with the same Referer/Origin the BSE website uses, while NSE
// aggressively blocks datacenter IPs. Every NSE-listed large/mid cap is dual listed.
import { getJSON, sleep } from "../util/http";

export interface BseAnnouncement {
  NEWSID: string;
  SCRIP_CD: number;
  NEWSSUB: string;
  HEADLINE: string;
  MORE: string;
  NEWS_DT: string; // IST, no offset
  CATEGORYNAME: string;
  SUBCATNAME: string;
  CRITICALNEWS: string;
  ATTACHMENTNAME: string;
  SLONGNAME: string;
  PDFFLAG: number;
}

const API = "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w";
const HEADERS = {
  Referer: "https://www.bseindia.com/",
  Origin: "https://www.bseindia.com",
  Accept: "application/json, text/plain, */*",
};

const ymd = (d: Date) => {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 10).replace(/-/g, "");
};

export async function fetchAnnouncements(scrip: number, from: Date, to: Date = new Date()): Promise<BseAnnouncement[]> {
  const out: BseAnnouncement[] = [];
  for (let page = 1; page <= 6; page++) {
    const url =
      `${API}?pageno=${page}&strCat=-1&strPrevDate=${ymd(from)}&strScrip=${scrip}` +
      `&strSearch=P&strToDate=${ymd(to)}&strType=C&subcategory=-1`;
    const j = await getJSON<{ Table?: BseAnnouncement[] }>(url, { headers: HEADERS });
    const t = j.Table || [];
    out.push(...t);
    if (t.length < 50) break;
    await sleep(250);
  }
  return out;
}

export function pdfUrl(a: Pick<BseAnnouncement, "ATTACHMENTNAME" | "NEWS_DT">): string | null {
  if (!a.ATTACHMENTNAME) return null;
  // Recent files live in AttachLive; BSE moves them to AttachHis after a while.
  // AnnPdfOpen resolves either, so we link to it.
  return `https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=${a.ATTACHMENTNAME}`;
}

export function pdfDirectUrls(attachment: string): string[] {
  return [
    `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${attachment}`,
    `https://www.bseindia.com/xml-data/corpfiling/AttachHis/${attachment}`,
  ];
}

export const BSE_PDF_HEADERS = { Referer: "https://www.bseindia.com/" };
