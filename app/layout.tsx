import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import "./owner-portal.css";
import "./deployment-setup.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;

  return {
    metadataBase: new URL(`${protocol}://${host}`),
    title: "HD SEO — Autonomous SEO, Accountable Results",
    description: "HD SEO finds, prioritizes, implements, validates, and measures the safest, highest-value SEO work for your business.",
    keywords: ["SEO operating system", "autonomous SEO", "local SEO", "agency SEO software", "SEO ROI"],
    alternates: { canonical: "/" },
    openGraph: { title: "Turn SEO into a measurable growth system.", description: "Evidence-led SEO planning, controlled execution, and verified outcomes in one operating system.", type: "website", siteName: "HD SEO", images: [{ url: image, width: 1774, height: 887, alt: "HD SEO — autonomous SEO, accountable results" }] },
    twitter: { card: "summary_large_image", title: "Turn SEO into a measurable growth system.", description: "Evidence-led SEO planning, controlled execution, and verified outcomes.", images: [image] },
    robots: { index: true, follow: true },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
