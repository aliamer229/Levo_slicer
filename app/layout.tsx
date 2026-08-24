import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LEVO Web Slicer",
  description: "A mobile-first, local browser slicer for Bambu Lab printers.",
  applicationName: "LEVO Web Slicer",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "LEVO Web Slicer",
    description: "Real browser slicing, designed for your phone.",
    type: "website",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "LEVO Web Slicer",
    description: "Real browser slicing, designed for your phone.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
