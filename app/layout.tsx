import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TimeSlot — Smart Task Scheduler",
  description: "Schedule your tasks. Focus on what matters.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TimeSlot",
  },
};

export const viewport: Viewport = {
  themeColor: "#027381",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="google-site-verification" content="TdlQdaF94FMlS6y2z-KrippaT-7QgCyr4428UcoRPPY" />
        <link rel="apple-touch-icon" href="/icon.svg" />
      </head>
      <body className={`${inter.className} antialiased bg-surface-50 min-h-screen`}>
        {children}
      </body>
    </html>
  );
}
