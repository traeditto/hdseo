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
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  VERCEL_ACCESS_TOKEN: z.string().optional(),
  VERCEL_TEAM_ID: z.string().optional(),
  VERCEL_PROJECT_ID: z.string().optional(),
  VERCEL_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional().or(z.literal("")),
  CRON_SECRET: z.string().min(16).optional().or(z.literal("")),
  APP_ENCRYPTION_KEY: z.string().min(32).optional().or(z.literal("")),
  NEXT_PUBLIC_APP_URL: optionalUrl,
  PLATFORM_ADMIN_EMAILS: z.string().optional(),
  MAX_DAILY_DATAFORSEO_COST_USD: z.coerce.number().positive().default(25),
  MAX_KEYWORDS_PER_RUN: z.coerce.number().int().positive().max(700).default(100),
  MAX_MAP_GRID_POINTS: z.coerce.number().int().positive().max(49).default(49),
  MAX_COMPETITORS_PER_RUN: z.coerce.number().int().positive().max(100).default(25),
  MAX_CRAWL_PAGES: z.coerce.number().int().positive().max(10_000).default(500),
  JOB_BATCH_SIZE: z.coerce.number().int().positive().max(50).default(10),
});

export const env = schema.parse(process.env);
export const hasSupabaseConfig = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export const hasSupabaseAdminConfig = Boolean(hasSupabaseConfig && env.SUPABASE_SERVICE_ROLE_KEY);
export const hasDataForSeoConfig = Boolean(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD);
export const hasGitHubConfig = Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);
export const platformAdminEmails = new Set((env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
