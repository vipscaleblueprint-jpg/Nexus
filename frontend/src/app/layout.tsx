import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClientLayout } from "./ClientLayout";
import { PRE_PAINT_THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#131316" },
  ],
};

export const metadata: Metadata = {
  title: "Nexus — Enterprise Project Management Platform",
  description: "ClickUp-style workspace with Notion minimalist design and multi-role authorization.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          id="nexus-theme-prepaint"
          dangerouslySetInnerHTML={{ __html: PRE_PAINT_THEME_SCRIPT }}
        />
        <script
          id="nexus-safe-pointer-capture"
          dangerouslySetInnerHTML={{
            __html: `(function(){if(typeof Element!=='undefined'&&Element.prototype.releasePointerCapture){var orig=Element.prototype.releasePointerCapture;Element.prototype.releasePointerCapture=function(id){try{if(this.hasPointerCapture&&!this.hasPointerCapture(id)){return;}return orig.call(this,id);}catch(e){}};}})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-background text-foreground">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
