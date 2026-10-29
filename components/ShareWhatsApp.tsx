"use client";
import { Icon } from "./Icon";

/**
 * Share a card to WhatsApp (or any app) with no setup: WhatsApp's own share link carries the
 * text and a link back into FINN. On phones with the system share sheet, that's offered too.
 */
export function ShareWhatsApp({ text, path, label = "WhatsApp" }: { text: string; path: string; label?: string }) {
  const go = () => {
    const url = `${window.location.origin}${path}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n\n${url}`)}`, "_blank", "noopener");
  };
  return (
    <button onClick={go} className="flex items-center gap-1 font-semibold text-[#1DA851]" aria-label="Share on WhatsApp">
      <Icon name="whatsapp" size={15} />
      {label}
    </button>
  );
}

/** Plain-text versions of FINN cards for sharing. */
export function shareText(lines: (string | null | undefined | false)[]) {
  return lines.filter(Boolean).join("\n");
}
