import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LEVO Studio — Browser Plate Editor & Slicer",
  description: "A mobile-first local plate editor, browser slicer, and Bambu print handoff for X2D and H2D profiles.",
  applicationName: "LEVO Web Slicer",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "LEVO Studio",
    description: "Real plate editing, local slicing, and print-file handoff for desktop and phone.",
    type: "website",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "LEVO Studio",
    description: "Real plate editing, local slicing, and print-file handoff for desktop and phone.",
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
