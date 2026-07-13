import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;

  return {
    title: "HD SEO — Admin, Agency & Client Portals",
    description: "Secure role-based access to the HD SEO operating platform.",
    openGraph: { title: "HD SEO", description: "One SEO operating system with purpose-built Admin, Agency, and Client workspaces.", type: "website", images: [{ url: image, width: 1732, height: 908, alt: "HD SEO operating platform" }] },
    twitter: { card: "summary_large_image", title: "HD SEO", description: "Secure Admin, Agency, and Client SEO workspaces.", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
