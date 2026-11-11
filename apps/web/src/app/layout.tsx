import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import { AnalyticsConsent } from "@/components/AnalyticsConsent.tsx";
import { UpdateBanner } from "@/components/UpdateBanner.tsx";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });

export const metadata: Metadata = {
  title: "Chitrapx",
  description: "Store screenshots that sell, made by AI and finished by you",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${bricolage.variable}`}>
      <body>
        <UpdateBanner />
        {children}
        <AnalyticsConsent />
      </body>
    </html>
  );
}
