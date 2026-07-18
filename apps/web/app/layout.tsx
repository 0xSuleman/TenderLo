import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { PageTransition } from "@/components/motion";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });

export const metadata: Metadata = {
  title: "TenderLo - Pakistan Tender Intelligence SaaS",
  description: "PEC-aware tender discovery, Profile Vault, compliance checks, recommendations, and machine-validated tender intelligence for Pakistani contractors."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>): JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${spaceGrotesk.variable} font-sans`} suppressHydrationWarning>
        <PageTransition>{children}</PageTransition>
      </body>
    </html>
  );
}
