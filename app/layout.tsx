import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuantFarm AI — Paper Trading",
  description: "Terminal de paper trading manuel, assisté, autonome et historique.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr-CA">
      <body>{children}</body>
    </html>
  );
}
