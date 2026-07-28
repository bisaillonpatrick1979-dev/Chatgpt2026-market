import type { Metadata } from "next";
import { GlobalNavigation } from "@/components/global-navigation";
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
        {children}
      </body>
    </html>
  );
}
