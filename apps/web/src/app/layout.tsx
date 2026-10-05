import type { Metadata } from "next";
import { AnalyticsConsent } from "@/components/AnalyticsConsent.tsx";
import { UpdateBanner } from "@/components/UpdateBanner.tsx";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chitrapx",
  description: "Store screenshots that sell, made by AI and finished by you",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <UpdateBanner />
        <AnalyticsConsent />
      </body>
    </html>
  );
}
