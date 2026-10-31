import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from './context/AuthContext';
import SidebarWrapper from '../components/SidebarWrapper';
import PwaInitializer from '../components/PwaInitializer';

export const viewport = {
  themeColor: '#f4f6f5',
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Bangla / Bengali fonts for the Official PDF Generator
// Loaded via standard Google Fonts link tag to avoid Tailwind CSS @import ordering errors
// font-family: 'Hind Siliguri', sans-serif;
// font-family: 'Noto Sans Bengali', sans-serif;

export const metadata: Metadata = {
  title: {
    default: "ANCHOR ERP",
    template: "%s | ANCHOR ERP",
  },
  description:
    "ANCHOR ERP — a secure, all-in-one platform for managing employee salaries, partner payouts, KYC verification, company expenses, and real-time payment tracking.",
  keywords: [
    "ERP",
    "payment management",
    "salary management",
    "partner payout",
    "KYC verification",
    "company expenses",
    "payment tracking",
    "Anchor ERP",
    "fintech dashboard",
    "BDT payment system",
  ],
  authors: [{ name: "ANCHOR ERP" }],
  creator: "ANCHOR ERP",
  applicationName: "ANCHOR ERP",
  metadataBase: new URL("https://paymentmanagement.vercel.app"),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://paymentmanagement.vercel.app",
    siteName: "ANCHOR ERP",
    title: "ANCHOR ERP",
    description:
      "Secure, all-in-one platform for managing employee salaries, partner payouts, KYC verification, and company expenses.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "ANCHOR ERP Dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ANCHOR ERP",
    description:
      "Secure, all-in-one platform for managing employee salaries, partner payouts, KYC verification, and company expenses.",
    images: ["/og-image.png"],
  },
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/icon-192x192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Auth state handled in SidebarWrapper (client component)  // Triggering Next.js router rebuild
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning={true}
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@300;400;500;600;700&family=Noto+Sans+Bengali:wght@100..900&display=swap" rel="stylesheet" />
        <style>
          {`
            :root {
              --font-hind-siliguri: 'Hind Siliguri', sans-serif;
              --font-noto-sans-bengali: 'Noto Sans Bengali', sans-serif;
            }
          `}
        </style>
      </head>
      <body className="min-h-full flex flex-col md:flex-row font-sans" suppressHydrationWarning={true}>
        <PwaInitializer />
        <AuthProvider>
          <SidebarWrapper />
          <div className="flex-1 min-w-0 w-full">
            {children}
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
