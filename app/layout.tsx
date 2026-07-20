import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import "./owner-portal.css";
import "./deployment-setup.css";
import "./agency-billing.css";
import { SecureFetchBootstrap } from "@/app/ui/secure-fetch-bootstrap";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;

  return {
    metadataBase: new URL(`${protocol}://${host}`),
    title: "HD SEO — Find, Approve, Implement, Measure",
    description: "Find the highest-value SEO improvement, approve it, and let HD SEO implement and measure the result.",
    keywords: ["SEO operating system", "autonomous SEO", "local SEO", "agency SEO software", "SEO ROI"],
    alternates: { canonical: "/" },
    openGraph: { title: "Find the best SEO improvement. Approve it. Measure it.", description: "A controlled SEO workflow for local service businesses, starting with a free 25-page audit.", type: "website", siteName: "HD SEO", url: "/", images: [{ url: image, width: 1774, height: 887, alt: "HD SEO — find, approve, implement, and measure" }] },
    twitter: { card: "summary_large_image", title: "Find the best SEO improvement. Approve it. Measure it.", description: "A controlled SEO workflow for local service businesses.", images: [image] },
    robots: { index: true, follow: true },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}><SecureFetchBootstrap/>{children}</body></html>;
}
