import { z } from "zod";
import { createHash } from "node:crypto";

import { jsonError } from "@/lib/api/errors";
import { parseJson } from "@/lib/api/request";
import { enforceRateLimit } from "@/lib/automation/control-plane";
import { completeWebsiteConnectionInvite, inspectWebsiteConnectionInvite } from "@/lib/websites/connection-invites";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("wordpress"), siteUrl: z.string().url().max(500), username: z.string().trim().min(1).max(200), applicationPassword: z.string().trim().min(8).max(500) }),
  z.object({ mode: z.literal("shopify"), siteUrl: z.string().trim().min(3).max(500), accessToken: z.string().trim().min(8).max(2000) }),
  z.object({ mode: z.literal("webflow"), siteUrl: z.string().url().max(500), siteId: z.string().trim().min(2).max(200), accessToken: z.string().trim().min(8).max(2000) }),
]);

function responseHeaders() {
  return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
}

const rateScope = (token: string) => `website-handoff:${createHash("sha256").update(token).digest("hex").slice(0, 20)}`;

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    await enforceRateLimit(rateScope(token), "read", 60, 3600);
    return Response.json({ ok: true, invite: await inspectWebsiteConnectionInvite(token) }, { headers: responseHeaders() });
  } catch (error) {
    const response = jsonError(error);
    for (const [key, value] of Object.entries(responseHeaders())) response.headers.set(key, value);
    return response;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    await enforceRateLimit(rateScope(token), "connect", 10, 3600);
    const input = await parseJson(request, schema);
    const result = await completeWebsiteConnectionInvite(token, input);
    return Response.json({ ok: true, result }, { headers: responseHeaders() });
  } catch (error) {
    const response = jsonError(error);
    for (const [key, value] of Object.entries(responseHeaders())) response.headers.set(key, value);
    return response;
  }
}
