import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, DotGothic16, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { SiteFooter } from "@/components/SiteFooter";
import { TooltipLayer } from "@/components/TooltipLayer";
import { collapseBootScript } from "@/lib/collapse-boot";
import { THEME_KEY } from "@/lib/keys";

const sans = IBM_Plex_Sans({ variable: "--f-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const cond = Barlow_Condensed({ variable: "--f-cond", subsets: ["latin"], weight: ["500", "600", "700"] });
const mono = IBM_Plex_Mono({ variable: "--f-mono", subsets: ["latin"], weight: ["400", "500", "600"] });
// 1.17: the departures board's dot matrix (only that view uses it, so it isn't preloaded)
const dot = DotGothic16({ variable: "--f-dot", subsets: ["latin"], weight: "400", preload: false });

export const metadata: Metadata = {
  title: "OFP Planner",
  description: "Find a real airline flight for your sim, roll a random one, and send it to SimBrief. Runs entirely in your browser.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf9f3" },
    { media: "(prefers-color-scheme: dark)", color: "#121a27" },
  ],
};

const themeScript = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${cond.variable} ${mono.variable} ${dot.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: collapseBootScript }} />
      </head>
      <body>
        {children}
        <TooltipLayer />
        <SiteFooter />
      </body>
    </html>
  );
}
