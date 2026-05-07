import type { Metadata, Viewport } from "next";
import { Orbitron, Manrope, Geist_Mono, Fraunces } from "next/font/google";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import OnboardingTour from "@/components/OnboardingTour";
import UnpaidPaymentsBanner from "@/components/UnpaidPaymentsBanner";

const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["500", "600"],
  style: "italic",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ElectroMarket — Buy & sell used electronics",
  description:
    "Phones, laptops, consoles, cameras and more, from trusted sellers across Australia.",
};

// Without `initial-scale=1` mobile Safari sometimes lands on a zoomed-out
// width and the layout looks like a tiny desktop screenshot. `viewport-fit`
// lets backgrounds extend under the iOS notch when we ever opt into it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// CSP nonces are generated per-request in middleware.ts, which only works if
// the page is rendered per-request. Without this, Vercel caches static HTML
// from build time (no nonce stamped) but the CSP header carries a fresh nonce
// each request — every inline hydration script then violates CSP and React
// never mounts.
export const dynamic = 'force-dynamic';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${orbitron.variable} ${manrope.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* External theme-init script keeps script-src CSP free of unsafe-inline. */}
        <script src="/theme-init.js" />
      </head>
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <UnpaidPaymentsBanner />
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
          <OnboardingTour />
        </AuthProvider>
      </body>
    </html>
  );
}
