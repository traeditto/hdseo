import { createHash } from "node:crypto";
import { z } from "zod";

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseJson } from "@/lib/api/request";
import { ApiError, jsonError } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/automation/control-plane";
import {
  advancePackage,
  agencyMembership,
  createAgencyForUser,
  createClientWithProject,
  createOpportunity,
  createPackage,
  controlCampaignJob,
  discoverKeywordOpportunities,
  liveAdminSnapshot,
  liveAgencySnapshot,
  liveClientSnapshot,
  recordClientPackageDecision,
  reviewCampaignJob,
  updateTaskStatus,
  upsertLiveUser,
} from "@/lib/live/store";
import {
  connectWebsite,
  disconnectWebsite,
  testWebsiteConnection,
} from "@/lib/websites/connections";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_agency"),
    name: z.string().trim().min(2).max(100),
  }),
  z.object({
    action: z.literal("create_client"),
    name: z.string().trim().min(2).max(120),
    domain: z.string().trim().min(3).max(200),
    contactEmail: z.string().email().optional().or(z.literal("")),
  }),
  z.object({
    action: z.literal("create_opportunity"),
    projectId: z.string().uuid(),
    keyword: z.string().trim().min(2).max(200),
    currentRank: z.number().int().min(1).max(100).optional(),
    targetRank: z.number().int().min(1).max(20).default(10),
    actionType: z.enum([
      "IMPROVE",
      "BUILD",
      "TECHNICAL",
      "LINK",
      "LOCALIZE",
      "CONTENT",
      "MAPS",
      "CTR_WIN",
    ]),
    reason: z.string().trim().min(10).max(1000),
  }),
  z.object({
    action: z.literal("discover_keywords"),
    projectId: z.string().uuid(),
    monthlyBudget: z.number().int().min(100).max(1_000_000),
    targetMarket: z.string().trim().min(2).max(120).default("United States"),
    limit: z.number().int().min(10).max(100).default(50),
  }),
  z.object({
    action: z.literal("create_package"),
    opportunityId: z.string().uuid(),
    implementationPath: z.enum([
      "wordpress_package",
      "generic_cms",
      "developer_ticket",
    ]),
  }),
  z.object({
    action: z.literal("approve_package"),
    packageId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("publish_package"),
    packageId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("package_decision"),
    packageId: z.string().uuid(),
    decision: z.enum(["client_approved", "revision_requested", "rejected"]),
  }),
  z.object({
    action: z.literal("update_task"),
    taskId: z.string().uuid(),
    status: z.enum([
      "ready",
      "in_progress",
      "awaiting_review",
      "completed",
      "blocked",
    ]),
  }),
  z.object({
    action: z.literal("mark_implemented"),
    packageId: z.string().uuid(),
    liveUrl: z.string().url(),
    proof: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    action: z.literal("verify_package"),
    packageId: z.string().uuid(),
    checks: z.object({
      pageResolves: z.literal(true),
      contentPresent: z.literal(true),
      metadataCorrect: z.literal(true),
      schemaValid: z.literal(true),
      internalLinksPresent: z.literal(true),
      noIndexingRegression: z.literal(true),
    }),
    proof: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    action: z.literal("control_job"),
    jobId: z.string().uuid(),
    command: z.enum(["cancel", "retry"]),
  }),
  z.object({
    action: z.literal("review_job"),
    jobId: z.string().uuid(),
    decision: z.enum(["proceed", "dismiss"]),
  }),
  z.object({
    action: z.literal("connect_website"),
    projectId: z.string().uuid(),
    mode: z.enum(["wordpress", "shopify", "webflow", "manual", "monitoring", "managed"]),
    siteUrl: z.string().trim().min(3).max(500),
    username: z.string().trim().max(200).optional(),
    applicationPassword: z.string().trim().max(500).optional(),
    accessToken: z.string().trim().max(2000).optional(),
    siteId: z.string().trim().max(200).optional(),
    platformName: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(2000).optional(),
  }),
  z.object({
    action: z.literal("test_website"),
    websiteId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("disconnect_website"),
    websiteId: z.string().uuid(),
    confirm: z.literal(true),
  }),
]);

async function identity() {
  let user = await getChatGPTUser();
  if (!user) {
    const session = await createSupabaseServerClient();
    const account = session ? (await session.auth.getUser()).data.user : null;
    if (account?.email) {
      const displayName = String(account.user_metadata?.full_name || account.user_metadata?.name || account.email.split("@")[0]);
      user = { displayName, email: account.email, fullName: displayName };
    }
  }
  if (!user) {
    throw new ApiError("Sign in to HD SEO to continue.", 401, "AUTH_REQUIRED");
  }
  await upsertLiveUser(user);
  return { ...user, email: user.email.toLowerCase() };
}

export async function GET(request: Request) {
  try {
    const user = await identity();
    const scope = new URL(request.url).searchParams.get("scope") ?? "agency";
    if (scope === "admin") {
      return Response.json({
        ok: true,
        user,
        data: await liveAdminSnapshot(user.email),
      });
    }
    if (scope === "client") {
      return Response.json({
        ok: true,
        user,
        data: await liveClientSnapshot(user.email),
      });
    }
    return Response.json({
      ok: true,
      user,
      data: await liveAgencySnapshot(user.email),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await identity();
    const input = await parseJson(request, schema);
    const actorScope = `live:${createHash("sha256").update(user.email).digest("hex")}`;
    await enforceRateLimit(actorScope, "mutation", 120, 60);
    if (input.action === "discover_keywords") {
      await enforceRateLimit(actorScope, "paid_keyword_discovery", 6, 3600);
    } else if (input.action === "create_agency") {
      await enforceRateLimit(actorScope, "agency_creation", 3, 86400);
    } else if (input.action === "package_decision") {
      await enforceRateLimit(actorScope, "client_decision", 30, 3600);
    } else if (["connect_website", "test_website", "disconnect_website"].includes(input.action)) {
      await enforceRateLimit(actorScope, "website_connection", 20, 3600);
    }

    if (input.action === "create_agency") {
      if (await agencyMembership(user.email)) {
        throw new ApiError(
          "You already belong to an agency workspace.",
          409,
          "CONFLICT",
        );
      }
      await createAgencyForUser(user.email, input.name);
      return Response.json({ ok: true, data: await liveAgencySnapshot(user.email) });
    }

    // Client-scoped decision: recorded against the client's own portal view.
    if (input.action === "package_decision") {
      await recordClientPackageDecision(user.email, {
        packageId: input.packageId,
        decision: input.decision,
      });
      return Response.json({ ok: true, data: await liveClientSnapshot(user.email) });
    }

    switch (input.action) {
      case "create_client":
        await createClientWithProject(user.email, {
          name: input.name,
          domain: input.domain,
          contactEmail: input.contactEmail || undefined,
        });
        break;
      case "create_opportunity":
        await createOpportunity(user.email, {
          projectId: input.projectId,
          keyword: input.keyword,
          currentRank: input.currentRank,
          targetRank: input.targetRank,
          actionType: input.actionType,
          reason: input.reason,
        });
        break;
      case "discover_keywords": {
        const summary = await discoverKeywordOpportunities(user.email, {
          projectId: input.projectId,
          monthlyBudget: input.monthlyBudget,
          targetMarket: input.targetMarket,
          limit: input.limit,
        });
        return Response.json({
          ok: true,
          data: await liveAgencySnapshot(user.email),
          message: `${summary.selected} best-value keyword opportunities found from ${summary.analyzed} site-relevant records. Provider cost: $${summary.providerCost.toFixed(2)}.${summary.jobId ? " The autonomous planning run is now queued." : ""}`,
          summary,
        });
      }
      case "create_package":
        await createPackage(user.email, {
          opportunityId: input.opportunityId,
          implementationPath: input.implementationPath,
        });
        break;
      case "update_task":
        await updateTaskStatus(user.email, {
          taskId: input.taskId,
          status: input.status,
        });
        break;
      case "control_job":
        await controlCampaignJob(user.email, {
          jobId: input.jobId,
          command: input.command,
        });
        break;
      case "review_job":
        await reviewCampaignJob(user.email, {
          jobId: input.jobId,
          decision: input.decision,
        });
        break;
      case "connect_website": {
        const connected = await connectWebsite(user.email, input);
        return Response.json({
          ok: true,
          data: await liveAgencySnapshot(user.email),
          message: connected.status === "pending" ? "Managed onboarding request saved." : "Website connection verified and saved.",
        });
      }
      case "test_website": {
        const tested = await testWebsiteConnection(user.email, input.websiteId);
        return Response.json({ ok: true, data: await liveAgencySnapshot(user.email), message: tested.message });
      }
      case "disconnect_website":
        await disconnectWebsite(user.email, input.websiteId);
        return Response.json({ ok: true, data: await liveAgencySnapshot(user.email), message: "Website connection disconnected and credentials removed." });
      case "approve_package":
      case "publish_package":
      case "mark_implemented":
      case "verify_package":
        await advancePackage(user.email, input.packageId, input.action, {
          liveUrl: "liveUrl" in input ? input.liveUrl : undefined,
          proof: "proof" in input ? input.proof : undefined,
          checks: "checks" in input ? input.checks : undefined,
        });
        break;
    }

    return Response.json({ ok: true, data: await liveAgencySnapshot(user.email) });
  } catch (error) {
    return jsonError(error);
  }
}
