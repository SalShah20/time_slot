import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TimeSlot — Smart Task Timer",
  description: "Focus on your work. Let TimeSlot handle the timing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased bg-surface-50 min-h-screen`}>
        {children}
      </body>
    </html>
  );
}
