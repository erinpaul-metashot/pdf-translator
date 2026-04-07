import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "PDF Translator — Sarvam AI",
  description:
    "Translate PDF documents into 22+ Indian languages with layout preservation. Powered by Sarvam AI Document Intelligence.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body>{children}</body>
    </html>
  );
}
