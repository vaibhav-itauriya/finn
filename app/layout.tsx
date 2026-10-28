import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TabBar } from "@/components/TabBar";

export const metadata: Metadata = {
  title: "FINN",
  description: "Your portfolio's filings, triaged. Research grounded in what management actually said.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "FINN", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2F7F7" },
    { media: "(prefers-color-scheme: dark)", color: "#081216" },
  ],
};

// Apply the saved theme before first paint so there's no flash.
const themeBoot = `try{var t=localStorage.getItem('finn.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body className="font-sans min-h-dvh">
        <div className="mx-auto max-w-[520px] min-h-dvh pb-[calc(80px+env(safe-area-inset-bottom))]">{children}</div>
        <TabBar />
      </body>
    </html>
  );
}
