import type { Metadata } from "next";
import { BackgroundIntelligenceAgent } from "@/components/background-intelligence-agent";
import { GlobalNavigation } from "@/components/global-navigation";
import { MarketDataInspector } from "@/components/market-data-inspector";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuantFarm AI — Paper Trading",
  description: "Terminal de paper trading, intelligence IA et laboratoire de stratégies.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr-CA">
      <body>
        <GlobalNavigation />
        <BackgroundIntelligenceAgent />
        <MarketDataInspector />
        {children}
      </body>
    </html>
  );
}
