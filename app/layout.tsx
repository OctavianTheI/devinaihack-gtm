import type { Metadata } from "next";
import "./globals.css";

// Using system fonts instead of next/font/google: fetching Geist from
// Google Fonts fails in network-restricted environments (CI, offline demo
// venues, this sandbox). Swap in next/font/google or next/font/local if you
// want a custom typeface and have reliable network access.

export const metadata: Metadata = {
  title: "Sales Coach",
  description: "Monitor your sales team and train reps with a voice AI coach.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
