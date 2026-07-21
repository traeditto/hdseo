import { z } from "zod";
import { createHash } from "node:crypto";

import { jsonError } from "@/lib/api/errors";
import { parseJson } from "@/lib/api/request";
import { enforceRateLimit } from "@/lib/automation/control-plane";
import { selectWebsiteInviteRepository } from "@/lib/websites/connection-invites";

const schema = z.object({ repositoryId: z.coerce.number().int().positive() });

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const scope = createHash("sha256").update(token).digest("hex").slice(0, 20);
    await enforceRateLimit(`website-handoff:${scope}`, "repository", 10, 3600);
    const input = await parseJson(request, schema);
    return Response.json({ ok: true, result: await selectWebsiteInviteRepository(token, input.repositoryId) }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" } });
  } catch (error) {
    return jsonError(error);
  }
}
