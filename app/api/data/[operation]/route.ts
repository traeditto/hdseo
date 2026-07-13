import { z } from "zod";
import { resolveTenantContext, requirePermission } from "@/lib/auth/context";
import { jsonError, ApiError } from "@/lib/api/errors";
import { parseJson } from "@/lib/api/request";
import { providerOperations } from "@/lib/providers/dataforseo/operations";
import { dataForSeoRequest } from "@/lib/providers/dataforseo/client";
import { beginPaidOperation, finishPaidOperation,paidScopeHash } from "@/lib/providers/paid-operation";
import { persistProviderResults } from "@/lib/providers/dataforseo/persistence";
import type { ProviderOperation } from "@/lib/providers/dataforseo/types";

const operations = new Set<ProviderOperation>(["keyword_overview","ranked_keywords","competitor_discovery","relevant_pages"]);
const schema = z.object({ agencyId: z.string().uuid(), clientId: z.string().uuid(), projectId: z.string().uuid(), confirmationId: z.string().uuid(), keywords: z.array(z.string().min(2)).max(700).optional(), target: z.string().min(3).optional(), limit: z.number().int().min(1).max(1000).default(100), locationName: z.string().default("United States"), languageCode: z.string().length(2).default("en") });

export async function POST(request: Request, { params }: { params: Promise<{ operation: string }> }) {
  let paid: Awaited<ReturnType<typeof beginPaidOperation>> | null = null;
  try {
    const { operation: rawOperation } = await params;
    if (!operations.has(rawOperation as ProviderOperation)) throw new ApiError("Unknown provider operation.", 404, "NOT_FOUND");
    const operation = rawOperation as ProviderOperation;
    const input = await parseJson(request, schema);
    const context = await resolveTenantContext({ agencyId: input.agencyId, clientId: input.clientId, projectId: input.projectId, requireProject: true });
    requirePermission(context, "provider.authorize");
    const units = operation === "keyword_overview" ? input.keywords?.length ?? 0 : input.limit;
    if (!units || (operation === "keyword_overview" && !input.keywords?.length) || (operation !== "keyword_overview" && !input.target)) throw new ApiError("The provider request scope is incomplete.", 400, "VALIDATION_ERROR");
    const config = providerOperations[operation];
    const estimatedCost = Number((config.estimateUnitCost * units).toFixed(4));
    const scope={operation,keywords:input.keywords??null,target:input.target??null,limit:input.limit,locationName:input.locationName,languageCode:input.languageCode};
    paid = await beginPaidOperation(context, { confirmationId: input.confirmationId, operation, estimatedUnits: units, estimatedCost, scopeHash:paidScopeHash(scope) });
    const result = await dataForSeoRequest<unknown>(config.endpoint, config.payload(input), `${operation}:${paid.usageId}`);
    const persisted = await persistProviderResults(operation, paid, result.results);
    await finishPaidOperation(paid, { cost: result.totalCost, units: result.resultCount, status: "completed" });
    paid = null;
    return Response.json({ ok: true, meta: { actualCost: result.totalCost, resultCount: result.resultCount, ...persisted } });
  } catch (error) {
    if (paid) await finishPaidOperation(paid, { cost: 0, units: 0, status: "failed" }).catch(() => undefined);
    return jsonError(error);
  }
}
