import "server-only";

import { ApiError } from "@/lib/api/errors";
import { assertPublicSiteUrl } from "@/lib/websites/url-security";

export type DetectedWebsitePlatform =
  | "wordpress"
  | "shopify"
  | "squarespace"
  | "wix"
  | "webflow"
  | "vercel"
  | "custom";

export type WebsitePlatformAnalysis = {
  siteUrl: string;
  canonicalDomain: string;
  platform: DetectedWebsitePlatform;
  platformLabel: string;
  confidence: "high" | "medium" | "low";
  reachable: boolean;
  pageTitle: string | null;
};

const labels: Record<DetectedWebsitePlatform, string> = {
  wordpress: "WordPress",
  shopify: "Shopify",
  squarespace: "Squarespace",
  wix: "Wix",
  webflow: "Webflow",
  vercel: "Vercel or a custom website",
  custom: "Custom or another website platform",
};

function headerText(headers: Headers | Record<string, string | null | undefined>) {
  if (headers instanceof Headers) {
    return [...headers.entries()].map(([key, value]) => `${key}:${value}`).join("\n").toLowerCase();
  }
  return Object.entries(headers).map(([key, value]) => `${key}:${value ?? ""}`).join("\n").toLowerCase();
}

export function identifyWebsitePlatform(
  html: string,
  headers: Headers | Record<string, string | null | undefined> = {},
): Pick<WebsitePlatformAnalysis, "platform" | "platformLabel" | "confidence" | "pageTitle"> {
  const source = html.toLowerCase();
  const headerSource = headerText(headers);
  const signals: Array<{ platform: DetectedWebsitePlatform; confidence: "high" | "medium"; matches: boolean }> = [
    { platform: "wordpress", confidence: "high", matches: /wp-content|wp-includes|wp-json|wordpress/.test(source) || /x-pingback|wp-super-cache/.test(headerSource) },
    { platform: "shopify", confidence: "high", matches: /cdn\.shopify\.com|shopify\.theme|myshopify\.com/.test(source) || /x-shopid|x-shardid/.test(headerSource) },
    { platform: "squarespace", confidence: "high", matches: /static1\.squarespace\.com|squarespace-cdn\.com|squarespace\.com\/universal/.test(source) || /squarespace/.test(headerSource) },
    { platform: "wix", confidence: "high", matches: /wixstatic\.com|wix-code-sdk|_wix_browser_sess/.test(source) || /x-wix-request-id/.test(headerSource) },
    { platform: "webflow", confidence: "high", matches: /data-wf-site|webflow\.css|webflow\.js/.test(source) || /x-webflow/.test(headerSource) },
    { platform: "vercel", confidence: "medium", matches: /x-vercel-id|server:vercel/.test(headerSource) },
  ];
  const match = signals.find((signal) => signal.matches);
  const platform = match?.platform ?? "custom";
  const rawTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  return {
    platform,
    platformLabel: labels[platform],
    confidence: match?.confidence ?? "low",
    pageTitle: rawTitle?.slice(0, 180) || null,
  };
}

export async function detectWebsitePlatform(value: string): Promise<WebsitePlatformAnalysis> {
  let current = (await assertPublicSiteUrl(value)).siteUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      const normalized = await assertPublicSiteUrl(current);
      const response = await fetch(normalized.siteUrl, {
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "HDSEO-Onboarding/1.0 (+https://hdseo.vercel.app)",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new ApiError("The website redirected without a destination.", 400, "WEBSITE_VERIFICATION_FAILED");
        current = new URL(location, normalized.siteUrl).toString();
        continue;
      }
      const contentType = response.headers.get("content-type") ?? "";
      const html = contentType.includes("html") ? (await response.text()).slice(0, 1_500_000) : "";
      return {
        ...normalized,
        ...identifyWebsitePlatform(html, response.headers),
        reachable: response.status < 500,
      };
    }
    throw new ApiError("The website redirected too many times.", 400, "WEBSITE_VERIFICATION_FAILED");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("HD SEO could not reach this website. Check the address and try again.", 400, "WEBSITE_VERIFICATION_FAILED");
  } finally {
    clearTimeout(timeout);
  }
}
