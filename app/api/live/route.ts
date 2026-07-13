import { z } from "zod";

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { parseJson } from "@/lib/api/request";
import { ApiError, jsonError } from "@/lib/api/errors";
import {
  advancePackage,
  agencyMembership,
  createAgencyForUser,
  createClientWithProject,
  createOpportunity,
  createPackage,
  liveAdminSnapshot,
  liveAgencySnapshot,
  liveClientSnapshot,
  recordClientPackageDecision,
  updateTaskStatus,
  upsertLiveUser,
} from "@/lib/live/store";

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
    action: z.literal("create_package"),
    opportunityId: z.string().uuid(),
    implementationPath: z.enum([
      "wordpress_package",
      "generic_cms",
      "developer_ticket",
    ]),
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
  }),
  z.object({
    action: z.literal("verify_package"),
    packageId: z.string().uuid(),
  }),
]);

async function identity() {
  const user = await getChatGPTUser();
  if (!user) {
    throw new ApiError("Sign in with ChatGPT to continue.", 401, "AUTH_REQUIRED");
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
      case "publish_package":
      case "mark_implemented":
      case "verify_package":
        await advancePackage(user.email, input.packageId, input.action);
        break;
    }

    return Response.json({ ok: true, data: await liveAgencySnapshot(user.email) });
  } catch (error) {
    return jsonError(error);
  }
}
