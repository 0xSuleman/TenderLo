import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { PageTransition } from "@/components/motion";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

export const metadata: Metadata = {
  title: "TenderLo - Pakistan Tender Intelligence SaaS",
  description: "PEC-aware tender discovery, Profile Vault, compliance checks, recommendations, and QA-backed tender intelligence for Pakistani contractors."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>): JSX.Element {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${outfit.variable} font-sans`}>
        <PageTransition>{children}</PageTransition>
      </body>
    </html>
  );
}
