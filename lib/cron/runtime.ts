import "server-only";

import { env } from "@/lib/config/env";

export function guardWorkerCron(request: Request): Response | null {
  if (
    !env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`
  ) {
    return Response.json({ ok: false }, { status: 401 });
  }

  // Only the canonical HD SEO Vercel project may claim shared production work.
  // Preview and duplicate deployments fail closed even if a cron secret is copied.
  if (env.HDSEO_WORKER_RUNTIME !== "canonical") {
    return Response.json({
      ok: true,
      disabled: true,
      reason: "NON_CANONICAL_WORKER_RUNTIME",
      timestamp: new Date().toISOString(),
    });
  }

  return null;
}
