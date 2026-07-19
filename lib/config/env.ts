import "server-only";
import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATAFORSEO_LOGIN: z.string().optional(),
  DATAFORSEO_PASSWORD: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ANALYTICS_PROPERTY_ID: z.string().optional(),
  GOOGLE_BUSINESS_ACCOUNT_ID: z.string().optional(),
  GOOGLE_BUSINESS_LOCATION_ID: z.string().optional(),
  CALLRAIL_API_TOKEN: z.string().optional(),
  CALLRAIL_ACCOUNT_ID: z.string().optional(),
  HUBSPOT_PRIVATE_APP_TOKEN: z.string().optional(),
  HUBSPOT_CLIENT_SECRET: z.string().optional(),
  ATTRIBUTION_WEBHOOK_SECRET: z.string().min(24).optional().or(z.literal("")),
  CITATION_PROVIDER_API_KEY: z.string().optional(),
  CITATION_PROVIDER_BASE_URL: optionalUrl,
  VERCEL_ACCESS_TOKEN: z.string().optional(),
  VERCEL_CLIENT_ID: z.string().optional(),
  VERCEL_CLIENT_SECRET: z.string().optional(),
  VERCEL_INTEGRATION_SLUG: z.string().optional(),
  VERCEL_TEAM_ID: z.string().optional(),
  VERCEL_PROJECT_ID: z.string().optional(),
  VERCEL_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STARTER_MONTHLY: z.string().optional(),
  STRIPE_PRICE_GROWTH_MONTHLY: z.string().optional(),
  STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
  STRIPE_PRICE_AGENT_CAPACITY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional().or(z.literal("")),
  CRON_SECRET: z.string().min(16).optional().or(z.literal("")),
  APP_ENCRYPTION_KEY: z.string().min(32).optional().or(z.literal("")),
  NEXT_PUBLIC_APP_URL: optionalUrl,
  APP_URL: optionalUrl,
  PLATFORM_ADMIN_EMAILS: z.string().optional(),
  MAX_DAILY_DATAFORSEO_COST_USD: z.coerce.number().positive().default(2),
  MAX_DAILY_DATAFORSEO_PLATFORM_COST_USD: z.coerce.number().positive().default(5),
  MAX_KEYWORDS_PER_RUN: z.coerce.number().int().positive().max(700).default(100),
  MAX_MAP_GRID_POINTS: z.coerce.number().int().positive().max(49).default(49),
  MAX_COMPETITORS_PER_RUN: z.coerce.number().int().positive().max(100).default(25),
  MAX_CRAWL_PAGES: z.coerce.number().int().positive().max(10_000).default(500),
  JOB_BATCH_SIZE: z.coerce.number().int().positive().max(50).default(10),
  AUTOMATION_JOB_BATCH_SIZE: z.coerce.number().int().positive().max(50).default(10),
  AUTOMATION_MAX_CONCURRENT_PER_AGENCY: z.coerce.number().int().positive().max(50).default(5),
  PAGESPEED_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_PROJECT_ID: z.string().optional(),
  OPENAI_CREATIVE_MODEL: z.string().default("gpt-5.6-terra"),
  OPENAI_CREATIVE_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1000).max(12000).default(4500),
  OPENAI_MAX_COST_PER_REQUEST_USD: z.coerce.number().positive().max(10).default(0.2),
  OPENAI_MAX_DAILY_COST_PER_PROJECT_USD: z.coerce.number().positive().max(1000).default(0.5),
  OPENAI_MAX_DAILY_PLATFORM_COST_USD: z.coerce.number().positive().max(10000).default(5),
});

export const env = schema.parse(process.env);
export const hasSupabaseConfig = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export const hasSupabaseAdminConfig = Boolean(hasSupabaseConfig && env.SUPABASE_SERVICE_ROLE_KEY);
export const hasDataForSeoConfig = Boolean(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD);
export const hasGitHubConfig = Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);
export const hasGitHubInstallConfig = Boolean(hasGitHubConfig && env.GITHUB_APP_SLUG && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.APP_ENCRYPTION_KEY);
export const hasGoogleSearchConsoleConfig = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.APP_ENCRYPTION_KEY);
export const hasGoogleAnalyticsConfig = Boolean(hasGoogleSearchConsoleConfig);
export const hasGoogleBusinessProfileConfig = Boolean(hasGoogleSearchConsoleConfig);
export const hasAttributionWebhookConfig = Boolean(env.ATTRIBUTION_WEBHOOK_SECRET);
export const hasCreativeModelConfig = Boolean(env.OPENAI_API_KEY);
export const platformAdminEmails = new Set((env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));

// Stable, configured production base URL for all external callbacks.
// Never derived from request headers, VERCEL_URL, preview domains, or browser hostname.
export const DEFAULT_APP_URL = "https://hdseo.vercel.app";
export function appBaseUrl(): string {
  const configured = env.APP_URL || env.NEXT_PUBLIC_APP_URL || process.env.HD_SEO_LIVE_ORIGIN || DEFAULT_APP_URL;
  return configured.replace(/\/+$/, "");
}
// Canonical GitHub OAuth/App authorization + installation callback URL.
// Must exactly match the callback URL registered in the GitHub App.
export const GITHUB_CALLBACK_PATH = "/api/github/callback";
export function githubCallbackUrl(): string {
  return new URL(GITHUB_CALLBACK_PATH, `${appBaseUrl()}/`).toString();
}
export const GITHUB_SETUP_PATH = "/api/github/setup";
export function githubSetupUrl(): string {
  return new URL(GITHUB_SETUP_PATH, `${appBaseUrl()}/`).toString();
}
export const GOOGLE_CALLBACK_PATH = "/api/google/callback";
export function googleCallbackUrl(): string {
  return new URL(GOOGLE_CALLBACK_PATH, `${appBaseUrl()}/`).toString();
}
export const GOOGLE_SUITE_CALLBACK_PATH = "/api/google-suite/callback";
export function googleSuiteCallbackUrl(): string {
  return new URL(GOOGLE_SUITE_CALLBACK_PATH, `${appBaseUrl()}/`).toString();
}
