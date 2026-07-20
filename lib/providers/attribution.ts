import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/errors";
import { ingestLead } from "@/lib/outcomes/service";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";

type Tenant = {
  agencyId: string;
  clientId: string;
  projectId: string;
  userId: string | null;
};
type AttributionProvider = "callrail" | "hubspot";

const MAX_PROVIDER_PAGES = 20;
const callRailAuthorization = (token: string) => `Token token=${token}`;
function safeCallRailNextPage(value: string | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value, "https://api.callrail.com");
    return url.protocol === "https:" && url.hostname === "api.callrail.com"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

async function providerFetch<T>(
  provider: AttributionProvider,
  url: string,
  token: string,
  init: RequestInit = {},
) {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      authorization:
        provider === "callrail"
          ? callRailAuthorization(token)
          : `Bearer ${token}`,
      ...init.headers,
    },
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || !body) {
    throw new ApiError(
      response.status === 401
        ? "The provider credentials were rejected."
        : response.status === 403
          ? "The provider token does not have the required read permission."
          : response.status === 429
            ? "The provider rate limit was reached. HD SEO will retry later."
            : "The attribution provider could not be reached.",
      response.status === 401 || response.status === 403
        ? response.status
        : response.status === 429
          ? 429
          : 502,
      response.status === 429 ? "RATE_LIMITED" : "OPERATION_FAILED",
    );
  }
  return body;
}

export async function verifyAttributionCredentials(
  provider: AttributionProvider,
  credentials: { token: string; accountId?: string },
) {
  if (provider === "callrail") {
    const account = credentials.accountId?.trim();
    if (!account)
      throw new ApiError(
        "A CallRail account ID is required.",
        400,
        "VALIDATION_ERROR",
      );
    const result = await providerFetch<{
      accounts?: Array<{ id?: string | number; name?: string }>;
    }>("callrail", "https://api.callrail.com/v3/a.json", credentials.token);
    const selected = (result.accounts ?? []).find(
      (item) => String(item.id) === account,
    );
    if (!selected)
      throw new ApiError(
        "The CallRail API key cannot access that account ID.",
        403,
        "ROLE_FORBIDDEN",
      );
    return { externalAccountId: account, accountName: selected.name ?? account };
  }

  const result = await providerFetch<{
    portalId?: number;
    hubId?: number;
    user?: string;
  }>(
    "hubspot",
    "https://api.hubapi.com/integrations/v1/me",
    credentials.token,
  );
  await providerFetch<{ results?: Array<{ id?: string }> }>(
    "hubspot",
    "https://api.hubapi.com/crm/v3/objects/contacts?limit=1&properties=createdate",
    credentials.token,
  );
  return {
    externalAccountId: String(result.portalId ?? result.hubId ?? "hubspot"),
    accountName: result.user ?? "HubSpot",
  };
}

export async function saveAttributionConnection(
  db: SupabaseClient,
  tenant: Tenant,
  input: { provider: AttributionProvider; token: string; accountId?: string },
) {
  const verified = await verifyAttributionCredentials(input.provider, input);
  const now = new Date().toISOString();
  const saved = await db
    .from("integration_connections")
    .upsert(
      {
        agency_id: tenant.agencyId,
        client_organization_id: tenant.clientId,
        project_id: tenant.projectId,
        provider: input.provider,
        connection_type: "api_token",
        status: "active",
        external_account_id: verified.externalAccountId,
        selected_resource: input.accountId ?? verified.externalAccountId,
        encrypted_secret_reference: encryptSecret(
          JSON.stringify({ token: input.token, accountId: input.accountId }),
        ),
        scopes: ["read:outcomes"],
        last_verified_at: now,
        metadata: {
          accountName: verified.accountName,
          health: "ready",
          connectedAt: now,
        },
        updated_at: now,
      },
      { onConflict: "project_id,provider" },
    )
    .select("id")
    .single();
  if (saved.error || !saved.data)
    throw new ApiError(
      "The attribution connection could not be saved.",
      500,
      "DATABASE_BINDING_FAILED",
    );
  return { id: saved.data.id, ...verified };
}

function incrementalStart(lastSyncedAt: string | null) {
  const ninetyDaysAgo = Date.now() - 90 * 86_400_000;
  const overlap = lastSyncedAt
    ? new Date(lastSyncedAt).getTime() - 24 * 3_600_000
    : ninetyDaysAgo;
  return new Date(Math.max(ninetyDaysAgo, overlap));
}

async function syncCallRail(
  db: SupabaseClient,
  tenant: Tenant,
  token: string,
  account: string,
  lastSyncedAt: string | null,
  priorCursor?: string,
  priorWindowStart?: string,
) {
  type CallRailResponse = {
    calls?: Array<Record<string, unknown>>;
    has_next_page?: boolean;
    next_page?: string;
  };
  const start = priorWindowStart ?? incrementalStart(lastSyncedAt).toISOString().slice(0, 10);
  const fields = [
    "source",
    "medium",
    "landing_page_url",
    "keywords",
    "qualified",
    "customer_status",
    "duration",
    "tracking_phone_number",
  ].join(",");
  let url = safeCallRailNextPage(priorCursor) || `https://api.callrail.com/v3/a/${encodeURIComponent(account)}/calls.json?start_date=${start}&per_page=250&relative_pagination=true&fields=${encodeURIComponent(fields)}`;
  let written = 0;
  let pages = 0;
  let truncated = false;

  while (url && pages < MAX_PROVIDER_PAGES) {
    const result = await providerFetch<CallRailResponse>(
      "callrail",
      url,
      token,
    );
    for (const call of result.calls ?? []) {
      if (call.id == null) continue;
      await ingestLead(db, tenant, {
        source: "callrail",
        externalId: String(call.id),
        landingPageUrl:
          typeof call.landing_page_url === "string"
            ? call.landing_page_url
            : undefined,
        query: typeof call.keywords === "string" ? call.keywords : undefined,
        leadType: "call",
        status: String(call.customer_status ?? "completed"),
        qualified: call.qualified === true,
        occurredAt: String(call.start_time ?? new Date().toISOString()),
        metadata: {
          source: call.source,
          medium: call.medium,
          duration: call.duration,
          trackingPhoneNumber: call.tracking_phone_number,
        },
      });
      written += 1;
    }
    pages += 1;
    url = result.has_next_page
      ? safeCallRailNextPage(result.next_page)
      : "";
  }
  truncated = Boolean(url);
  return { written, pages, truncated, cursor: url || null, windowStart: start };
}

async function syncHubSpot(
  db: SupabaseClient,
  tenant: Tenant,
  token: string,
  lastSyncedAt: string | null,
  priorCursor?: string,
  priorWindowStart?: number,
) {
  type Contact = {
    id: string;
    properties?: Record<string, string>;
    createdAt?: string;
    updatedAt?: string;
  };
  type HubSpotResponse = {
    results?: Contact[];
    paging?: { next?: { after?: string } };
  };
  const startMs = priorWindowStart ?? incrementalStart(lastSyncedAt).getTime();
  let after: string | undefined = priorCursor;
  let written = 0;
  let pages = 0;

  do {
    const result = await providerFetch<HubSpotResponse>(
      "hubspot",
      "https://api.hubapi.com/crm/v3/objects/contacts/search",
      token,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "lastmodifieddate",
                  operator: "GTE",
                  value: String(startMs),
                },
              ],
            },
          ],
          properties: [
            "lifecyclestage",
            "hs_analytics_source",
            "hs_analytics_first_url",
            "createdate",
            "lastmodifieddate",
          ],
          sorts: ["lastmodifieddate"],
          limit: 200,
          ...(after ? { after } : {}),
        }),
      },
    );
    for (const contact of result.results ?? []) {
      const properties = contact.properties ?? {};
      const stage = properties.lifecyclestage ?? "lead";
      await ingestLead(db, tenant, {
        source: "hubspot",
        externalId: contact.id,
        landingPageUrl: properties.hs_analytics_first_url || undefined,
        leadType: "form",
        status: stage,
        qualified: ["salesqualifiedlead", "opportunity", "customer"].includes(
          stage,
        ),
        occurredAt:
          properties.createdate ??
          contact.createdAt ??
          new Date().toISOString(),
        metadata: {
          analyticsSource: properties.hs_analytics_source,
          lastModified: properties.lastmodifieddate ?? contact.updatedAt,
        },
      });
      written += 1;
    }
    after = result.paging?.next?.after;
    pages += 1;
  } while (after && pages < MAX_PROVIDER_PAGES);

  return { written, pages, truncated: Boolean(after), cursor: after ?? null, windowStart: startMs };
}

export async function syncAttributionConnection(
  db: SupabaseClient,
  tenant: Tenant,
  provider: AttributionProvider,
) {
  const connection = await db
    .from("integration_connections")
    .select(
      "id,encrypted_secret_reference,selected_resource,last_synced_at,metadata",
    )
    .eq("agency_id", tenant.agencyId)
    .eq("client_organization_id", tenant.clientId)
    .eq("project_id", tenant.projectId)
    .eq("provider", provider)
    .eq("status", "active")
    .maybeSingle();
  if (!connection.data?.encrypted_secret_reference)
    throw new ApiError(
      `Connect ${provider === "callrail" ? "CallRail" : "HubSpot"} first.`,
      409,
      "NOT_CONFIGURED",
    );

  let secret: { token: string; accountId?: string };
  try {
    secret = JSON.parse(
      decryptSecret(connection.data.encrypted_secret_reference),
    ) as typeof secret;
  } catch {
    throw new ApiError(
      "Reconnect the attribution provider because its stored authorization is invalid.",
      409,
      "NOT_CONFIGURED",
    );
  }

  const run = await db
    .from("provider_sync_runs")
    .insert({
      agency_id: tenant.agencyId,
      client_organization_id: tenant.clientId,
      project_id: tenant.projectId,
      connection_id: connection.data.id,
      provider,
      operation: "leads_and_revenue",
    })
    .select("id")
    .single();
  if (run.error || !run.data)
    throw new ApiError(
      "The provider sync could not be started.",
      500,
      "DATABASE_BINDING_FAILED",
    );

  try {
    const metadata = (connection.data.metadata ?? {}) as Record<string, unknown>;
    const priorCursor = typeof metadata.syncCursor === "string" ? metadata.syncCursor : undefined;
    const priorCallRailWindow = typeof metadata.syncWindowStart === "string" ? metadata.syncWindowStart : undefined;
    const priorHubSpotWindow = typeof metadata.syncWindowStart === "number" ? metadata.syncWindowStart : undefined;
    const result =
      provider === "callrail"
        ? await syncCallRail(
            db,
            tenant,
            secret.token,
            secret.accountId ?? String(connection.data.selected_resource),
            connection.data.last_synced_at,
            priorCursor,
            priorCallRailWindow,
          )
        : await syncHubSpot(
            db,
            tenant,
            secret.token,
            connection.data.last_synced_at,
            priorCursor,
            priorHubSpotWindow,
          );
    const completedAt = new Date().toISOString();
    await db
      .from("provider_sync_runs")
      .update({
        status: result.truncated ? "partial" : "succeeded",
        records_read: result.written,
        records_written: result.written,
        completed_at: completedAt,
        metadata: {
          pagesRead: result.pages,
          truncated: result.truncated,
          boundedPageLimit: MAX_PROVIDER_PAGES,
          syncCursor: result.cursor,
          syncWindowStart: result.windowStart,
        },
      })
      .eq("id", run.data.id);
    await db
      .from("integration_connections")
      .update({
        last_synced_at: result.truncated
          ? connection.data.last_synced_at
          : completedAt,
        last_verified_at: completedAt,
        metadata: {
          ...(connection.data.metadata ?? {}),
          health: result.truncated ? "partial" : "ready",
          lastRecordsWritten: result.written,
          lastPagesRead: result.pages,
          truncated: result.truncated,
          syncCursor: result.cursor,
          syncWindowStart: result.truncated ? result.windowStart : null,
        },
        updated_at: completedAt,
      })
      .eq("id", connection.data.id);
    return { provider, records: result.written, pages: result.pages, truncated: result.truncated };
  } catch (error) {
    await db
      .from("provider_sync_runs")
      .update({
        status: "failed",
        error_code: "PROVIDER_SYNC_FAILED",
        error_message: "Attribution synchronization failed.",
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.data.id);
    throw error;
  }
}
