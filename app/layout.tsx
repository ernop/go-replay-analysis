import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { Nav } from "@/components/nav";

export const metadata: Metadata = {
  title: "Go Game Replay",
  description: "Late-night Go game replayer with pre-computed KataGo analysis",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <Nav />
        <main className="flex-1 w-full px-2 py-2 sm:px-4 md:px-6">{children}</main>
        {/* Usage statistics, sent only on go-replayer.fuseki.net (PRODUCT.md "Usage statistics"). The file is
            fuseki4_ai's setup/apps/fuseki-stats.js, copied unchanged. */}
        <Script src="/fuseki-stats.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
