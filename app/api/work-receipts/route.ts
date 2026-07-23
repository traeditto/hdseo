import "server-only";

/* The receipt intentionally joins several post-migration tables whose generated
 * Supabase types lag the production schema. Every query is still tenant scoped. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { ApiError, jsonError } from "@/lib/api/errors";
import { requireLiveAgencyProject } from "@/lib/auth/live-tenant";
import {
  evaluateSeoInvestment,
  investmentPolicyForPlan,
} from "@/lib/seo/investment-policy";

const querySchema = z.object({
  projectId: z.string().uuid(),
  packageId: z.string().uuid(),
});

const record = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown, fallback = "") =>
  typeof value === "string" && value.trim() ? value : fallback;
const number = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const data = <T,>(result: { data: T | null; error: unknown }): T | null =>
  result.error ? null : result.data;

export async function GET(request: Request) {
  try {
    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(
        "Choose a valid project and approved work item.",
        400,
        "VALIDATION_ERROR",
      );

    const { projectId, packageId } = parsed.data;
    const context = await requireLiveAgencyProject({
      projectId,
      permission: "seo.read",
    });
    const scope = (query: any) =>
      query
        .eq("agency_id", context.agencyId)
        .eq("client_organization_id", context.clientId)
        .eq("project_id", projectId);

    const packageResult = await scope(
      context.db
        .from("implementation_packages")
        .select(
          "id,opportunity_id,action_draft_id,status,risk_level,implementation_path,hypothesis,current_state,proposed_state,package_data,acceptance_criteria,verification_checklist,approval_digest,approved_by,approved_at,implemented_at,created_at,updated_at",
        ),
    )
      .eq("id", packageId)
      .maybeSingle();
    if (packageResult.error || !packageResult.data)
      throw new ApiError(
        "This work item was not found in the selected business.",
        404,
        "NOT_FOUND",
      );
    const pkg = packageResult.data as any;

    const opportunityResult = await scope(
      context.db
        .from("seo_opportunities")
        .select(
          "id,keyword_id,action_type,opportunity_score,confidence_score,target_milestone,evidence,recommended_actions,status",
        ),
    )
      .eq("id", pkg.opportunity_id)
      .maybeSingle();
    const opportunity = data(opportunityResult as any) as any;
    const keywordResult = opportunity?.keyword_id
      ? await context.db
          .from("seo_keywords")
          .select("id,keyword,target_url")
          .eq("id", opportunity.keyword_id)
          .eq("project_id", projectId)
          .maybeSingle()
      : { data: null, error: null };
    const keyword = data(keywordResult as any) as any;
    const [metricResult, rankingResult] = keyword?.id
      ? await Promise.all([
          scope(
            context.db
              .from("keyword_metrics")
              .select("search_volume,cpc,difficulty,source,collected_at"),
          )
            .eq("keyword_id", keyword.id)
            .order("collected_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          scope(
            context.db
              .from("organic_ranking_snapshots")
              .select("position,ranking_url,search_engine,device,collected_at"),
          )
            .eq("keyword_id", keyword.id)
            .order("collected_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])
      : [{ data: null, error: null }, { data: null, error: null }];
    const metric = data(metricResult as any) as any;
    const ranking = data(rankingResult as any) as any;

    const [draftResult, runResult, cycleResult, verificationResult, proofResult, creativeResult, assetsResult, budgetResult, subscriptionResult] =
      await Promise.all([
        pkg.action_draft_id
          ? scope(
              context.db
                .from("seo_action_drafts")
                .select(
                  "id,execution_path,target_url,suggested_url,title_suggestion,meta_description_suggestion,content_brief,internal_link_recommendations,schema_recommendations,technical_instructions,status",
                ),
            )
              .eq("id", pkg.action_draft_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        scope(
          context.db
            .from("outcome_loop_runs")
            .select(
              "id,status,current_step,expected_value,observed_value,delivery_kind,delivery_proof,delivered_at,billed_at,failure_code,failure_message,started_at,completed_at,created_at,updated_at",
            ),
        )
          .eq("implementation_package_id", packageId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        scope(
          context.db
            .from("agent_service_cycles")
            .select(
              "id,status,stage,failure_code,failure_message,started_at,completed_at,updated_at",
            ),
        )
          .eq("implementation_package_id", packageId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        scope(
          context.db
            .from("implementation_verifications")
            .select(
              "id,status,live_url,checks,proof,verified_at,error_details,updated_at",
            ),
        )
          .eq("package_id", packageId)
          .maybeSingle(),
        scope(
          context.db
            .from("proof_of_work_events")
            .select("id,event_type,title,description,metadata,occurred_at"),
        )
          .eq("package_id", packageId)
          .eq("client_visible", true)
          .order("occurred_at", { ascending: false })
          .limit(30),
        scope(
          context.db
            .from("seo_creative_specs")
            .select(
              "id,target_keyword,search_intent,creative_angle,user_job,evidence_requirements,proof_asset_ids,visual_requirements,status,expected_value,created_at,updated_at",
            ),
        )
          .eq("opportunity_id", pkg.opportunity_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        scope(
          context.db
            .from("business_proof_assets")
            .select(
              "id,proof_type,title,summary,service,location,mime_type,verification_status,captured_at",
            ),
        )
          .order("captured_at", { ascending: false })
          .limit(50),
        scope(
          context.db
            .from("project_budget_accounts")
            .select("id,currency,monthly_limit,hard_stop,status"),
        ).maybeSingle(),
        scope(
          context.db
            .from("client_subscriptions")
            .select("plan_key,status,price_cents"),
        ).maybeSingle(),
      ]);

    const run = data(runResult as any) as any;
    const cycle = data(cycleResult as any) as any;
    const executionResult = await scope(
      context.db
        .from("seo_executions")
        .select(
          "id,status,action_type,base_branch,branch_name,pull_request_number,pull_request_url,production_commit_sha,production_deployed_at,validation_results,approved_at,executed_at,merged_at,created_at,updated_at",
        ),
    )
      .eq("opportunity_id", pkg.opportunity_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const execution = data(executionResult as any) as any;

    const [stepsResult, deploymentResult, legacyDeploymentResult, reservationResult, transactionResult, creativeDraftResult] =
      await Promise.all([
        run?.id
          ? scope(
              context.db
                .from("outcome_loop_steps")
                .select(
                  "id,sequence,step_key,step_kind,status,evidence,output,validation,started_at,completed_at,updated_at",
                ),
            )
              .eq("run_id", run.id)
              .order("sequence", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        run?.id
          ? context.db
              .from("deployments")
              .select(
                "id,environment,git_ref,git_sha,url,status,validation_summary,started_at,ready_at,completed_at,created_at",
              )
              .eq("agency_id", context.agencyId)
              .eq("project_id", projectId)
              .eq("outcome_run_id", run.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        execution?.id
          ? context.db
              .from("seo_deployments")
              .select(
                "id,provider,environment,commit_sha,deployment_id,deployment_url,status,error_details,started_at,completed_at,created_at",
              )
              .eq("execution_id", execution.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        run?.id
          ? scope(
              context.db
                .from("billable_usage_reservations")
                .select(
                  "id,capacity_source,quantity,unit_price_cents,customer_amount_cents,status,reserved_at,committed_at,released_at",
                ),
            )
              .eq("outcome_run_id", run.id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        budgetResult.data?.id
          ? scope(
              context.db
                .from("project_budget_transactions")
                .select(
                  "id,category,transaction_type,provider,description,amount,currency,approval_status,occurred_at,source_type,source_id",
                ),
            )
              .eq("budget_account_id", budgetResult.data.id)
              .gte(
                "occurred_at",
                new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
              )
              .order("occurred_at", { ascending: false })
              .limit(50)
          : Promise.resolve({ data: [], error: null }),
        creativeResult.data?.id
          ? scope(
              context.db
                .from("seo_creative_drafts")
                .select(
                  "id,title,meta_description,h1,summary,originality_score,evidence_coverage_score,helpfulness_score,conversion_score,qa_results,status,created_at,updated_at",
                ),
            )
              .eq("creative_spec_id", creativeResult.data.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

    const deployment = (data(deploymentResult as any) ??
      data(legacyDeploymentResult as any)) as any;
    const verification = data(verificationResult as any) as any;
    const reservation = data(reservationResult as any) as any;
    const assets = (data(assetsResult as any) ?? []) as any[];
    const transactions = (data(transactionResult as any) ?? []) as any[];
    const evidence = record(opportunity?.evidence);
    const businessValue = record(evidence.businessValue);
    const packageData = record(pkg.package_data);
    const metadata = record(packageData.metadata);
    const draft = data(draftResult as any) as any;
    const creative = data(creativeResult as any) as any;
    const creativeDraft = data(creativeDraftResult as any) as any;
    const proofEvents = (data(proofResult as any) ?? []) as any[];
    const steps = (data(stepsResult as any) ?? []) as any[];

    const approvalEvent = proofEvents.find((event) => event.event_type === "client_approved");
    const approvedAt = pkg.approved_at ?? approvalEvent?.occurred_at ?? null;
    const approvalRecorded = Boolean(approvedAt || pkg.approval_digest);
    const implementationStarted = Boolean(
      execution ||
        run?.status === "implementing" ||
        steps.some((step) =>
          ["running", "succeeded"].includes(step.status) &&
          ["implementation", "preview", "qa", "publish", "monitor"].includes(step.step_kind),
        ),
    );
    const previewQaPassed = Boolean(
      execution?.status === "preview_ready" ||
        (deployment?.environment === "preview" && deployment?.status === "healthy"),
    );
    const previewFailed = Boolean(
      execution?.status === "preview_failed" ||
        (deployment?.environment === "preview" && deployment?.status === "failed"),
    );
    const failedPreviewChecks = list(record(deployment?.validation_summary).failed).map(String);
    const published = Boolean(
      pkg.implemented_at ||
        execution?.production_deployed_at ||
        (deployment?.environment === "production" && deployment?.status === "healthy") ||
        ["monitoring", "completed"].includes(run?.status),
    );
    const productionChecksRunning = Boolean(
      deployment?.environment === "production" && ["building", "ready", "validating"].includes(deployment?.status),
    );
    const verified = Boolean(
      verification?.status === "passed" || run?.status === "completed",
    );
    const previewState = text(record(execution?.validation_results).preview?.status);
    const previewSetupRequired = Boolean(
      execution?.status === "pr_created" &&
        !deployment &&
        previewState === "setup_required",
    );
    const blocked = previewFailed || previewSetupRequired || [run?.status, cycle?.status].includes("blocked");
    const failureCode = run?.failure_code ?? cycle?.failure_code ?? (previewFailed
      ? "PREVIEW_QA_FAILED"
      : previewSetupRequired
        ? "CONNECTION_REQUIRED"
        : null);
    const failureMessage = run?.failure_message ?? cycle?.failure_message ?? (previewFailed
      ? `The preview stopped because ${failedPreviewChecks.length ? failedPreviewChecks.join(", ") : "a required safety check"} failed. Nothing was published. HD SEO automatically retries temporary hosting and access failures; a genuine page problem is returned for revision.`
      : previewSetupRequired
        ? "The approved change and GitHub pull request are safe, but no preview deployment was queued. HD SEO will automatically retry when the project has an active Vercel mapping; nothing was published or charged."
        : null);
    const stage = verified
      ? "verified"
      : published
        ? "monitoring"
        : productionChecksRunning
          ? "production checks"
        : previewQaPassed
          ? "release approval"
        : deployment
          ? "preview"
          : implementationStarted
            ? "implementation"
            : approvalRecorded
              ? "approved"
              : "proposed";
    const timeline = [
      { key: "proposed", label: "Plan prepared", complete: true },
      { key: "approved", label: "Customer approved", complete: approvalRecorded },
      { key: "implementation", label: "Change prepared", complete: implementationStarted },
      { key: "preview", label: "Preview created", complete: Boolean(deployment) },
      { key: "qa", label: "Safety checks passed", complete: previewQaPassed || verified || steps.some((step) => step.step_kind === "qa" && step.status === "succeeded") },
      { key: "published", label: "Published", complete: published },
      { key: "monitoring", label: "Results monitored", complete: verified },
    ];
    const externalSpent = transactions
      .filter((item) => item.transaction_type === "actual")
      .reduce((sum, item) => sum + (number(item.amount) ?? 0), 0);
    const keywordText = text(
      keyword?.keyword,
      text(evidence.keyword, text(creative?.target_keyword, "SEO opportunity")),
    );
    const expectedMonthlyProfit = number(
      run?.expected_value ??
        businessValue.expectedMonthlyProfit ??
        evidence.expectedMonthlyProfit ??
        evidence.estimatedMonthlyValue,
    );
    const currentPosition = number(
      ranking?.position ?? evidence.currentRank ?? evidence.current_position,
    );
    const investment = evaluateSeoInvestment(
      {
        expectedMonthlyProfit,
        implementationCost: number(businessValue.implementationCost),
        paybackMonths: number(businessValue.paybackMonths),
        confidenceScore: number(opportunity?.confidence_score),
        currentRank: currentPosition,
        actionType: opportunity?.action_type,
        economicsConfidence: number(evidence.economicsConfidence),
        opportunityScore: number(opportunity?.opportunity_score),
      },
      investmentPolicyForPlan(
        text(subscriptionResult.data?.plan_key, "agency_core"),
      ),
    );
    const needsCreative = ["BUILD", "CONTENT", "LOCALIZE", "CTR_WIN", "CONVERSION"].includes(
      text(opportunity?.action_type).toUpperCase(),
    );
    const verifiedAssets = assets.filter(
      (asset) => asset.verification_status === "verified",
    );
    const verifiedPhotos = verifiedAssets.filter(
      (asset) => asset.proof_type === "photo" || text(asset.mime_type).startsWith("image/"),
    );
    const latestProgressAt = [
      pkg.updated_at,
      run?.updated_at,
      cycle?.updated_at,
      execution?.updated_at,
      deployment?.completed_at,
      deployment?.created_at,
      verification?.updated_at,
      ...steps.map((step) => step.updated_at),
    ]
      .filter((value): value is string => typeof value === "string" && Boolean(value))
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
    const approvalNeeded = Boolean(
      !verified &&
        !blocked &&
        (run?.status === "awaiting_approval" || (!approvalRecorded && !implementationStarted)),
    );
    const continuesAutomatically = Boolean(
      !verified && !blocked && !approvalNeeded && (implementationStarted || published),
    );

    return Response.json({
      ok: true,
      receipt: {
        package: {
          id: pkg.id,
          title: text(metadata.title, text(packageData.title, "SEO improvement")),
          description: text(
            metadata.metaDescription,
            text(pkg.hypothesis, "HD SEO prepared this change from verified search evidence."),
          ),
          status: pkg.status,
          stage,
          riskLevel: pkg.risk_level,
          implementationPath: pkg.implementation_path,
          approvedAt,
          implementedAt: pkg.implemented_at,
          approvalBound: Boolean(pkg.approval_digest),
          proposedState: pkg.proposed_state,
          acceptanceCriteria: list(pkg.acceptance_criteria),
          verificationChecklist: list(pkg.verification_checklist),
        },
        proposal: {
          keyword: keywordText,
          actionType: opportunity?.action_type ?? null,
          score: number(opportunity?.opportunity_score),
          confidence: number(opportunity?.confidence_score),
          searchVolume: number(metric?.search_volume ?? evidence.searchVolume ?? evidence.search_volume),
          cpc: number(metric?.cpc ?? evidence.cpc),
          difficulty: number(metric?.difficulty ?? evidence.difficulty),
          currentPosition,
          targetUrl: text(draft?.target_url, text(keyword?.target_url, text(ranking?.ranking_url, text(evidence.targetUrl)))) || null,
          expectedValue: expectedMonthlyProfit,
          investment: {
            qualified: investment.qualified,
            verdict: investment.qualified
              ? "qualified_focus_investment"
              : "historical_below_threshold",
            reasons: investment.reasons,
            focusScore: investment.focusScore,
            implementationCost: investment.implementationCost,
            paybackMonths: investment.paybackMonths,
            twelveMonthNetValue: investment.twelveMonthNetValue,
            twelveMonthRoiPercent: investment.twelveMonthRoiPercent,
            minimumMonthlyProfit: investment.policy.minimumMonthlyProfit,
            maximumPaybackMonths: investment.policy.maximumPaybackMonths,
            minimumTwelveMonthRoiPercent:
              investment.policy.minimumTwelveMonthRoiPercent,
            planLabel: investment.policy.planLabel,
          },
          recommendations: list(opportunity?.recommended_actions),
          exactChange: draft
            ? {
                title: draft.title_suggestion,
                metaDescription: draft.meta_description_suggestion,
                contentBrief: draft.content_brief,
                internalLinks: draft.internal_link_recommendations,
                schema: draft.schema_recommendations,
                technicalInstructions: draft.technical_instructions,
              }
            : pkg.proposed_state,
        },
        execution: {
          hasStarted: implementationStarted,
          isPublished: published,
          isVerified: verified,
          status: execution?.status ?? run?.status ?? cycle?.status ?? pkg.status,
          blocked,
          failureCode,
          failureMessage,
          pickupTarget: approvalRecorded && !implementationStarted && !blocked
            ? "The protected worker should claim this within five minutes."
            : null,
          branch: execution?.branch_name ?? null,
          pullRequestUrl: execution?.pull_request_url ?? null,
          previewUrl:
            deployment?.environment === "preview"
              ? deployment.url ?? deployment.deployment_url ?? null
              : null,
          liveUrl:
            verification?.live_url ??
            (deployment?.environment === "production"
              ? deployment.url ?? deployment.deployment_url ?? null
              : null),
          validation: verification?.checks ?? execution?.validation_results ?? deployment?.validation_summary ?? null,
          verifiedAt: verification?.verified_at ?? run?.completed_at ?? null,
          nextAction: failureCode === "CONNECTION_REQUIRED"
            ? "Approval is safe, but HD SEO still needs a verified GitHub + Vercel, WordPress, Shopify, or Webflow publishing connection. No outcome capacity has been used."
            : failureCode === "CHECKOUT_REQUIRED"
              ? "Approval is safe, but the plan’s included outcome capacity is currently used. Add prepaid capacity or wait for renewal; no duplicate charge was created."
              : failureCode === "ACTIVE_WORK"
                ? "Another protected website workflow is finishing first. This approved change remains next in line and has not consumed outcome capacity."
                : failureMessage
                  ? failureMessage
                  : failureCode === "PREVIEW_QA_FAILED"
                    ? failureMessage
                  : previewQaPassed
                    ? "All preview safety checks passed. The exact protected release is ready for your final approval; HD SEO will continue automatically as soon as you approve it."
                  : verified
            ? "HD SEO is monitoring rankings, traffic, leads and value."
            : published
              ? "HD SEO is completing independent QA and starting measurement."
              : deployment
                ? "The preview is being checked before anything goes live."
                : implementationStarted
                  ? "The approved change is being prepared and remains rollback protected."
                  : approvalRecorded
                    ? "Approval is recorded and tied to this exact package. HD SEO is claiming the protected implementation job; nothing has been claimed as published yet."
                    : "Review the proposed change before HD SEO continues.",
        },
        automation: {
          continuesAutomatically,
          approvalNeeded,
          lastProgressAt: latestProgressAt,
          workerCadenceMinutes: continuesAutomatically ? 1 : null,
          message: continuesAutomatically
            ? "No action is needed. You can close this screen; the protected worker is scheduled every minute and this receipt refreshes automatically."
            : approvalNeeded
              ? "A plain-language decision is waiting in Approvals. HD SEO will continue automatically after that decision."
              : blocked
                ? "Automatic work is paused safely. The exact requirement is shown above; nothing will publish or be charged while it is blocked."
                : "This work is complete and its evidence remains available here.",
        },
        timeline,
        steps: steps.map((step) => ({
          key: step.step_key,
          kind: step.step_kind,
          status: step.status,
          completedAt: step.completed_at,
        })),
        proof: proofEvents.map((event) => ({
          id: event.id,
          type: event.event_type,
          title: event.title,
          description: event.description,
          occurredAt: event.occurred_at,
          url: text(record(event.metadata).url) || null,
        })),
        creative: {
          recommended: needsCreative,
          message: needsCreative
            ? `A custom creative would strengthen “${keywordText}” by pairing the search intent with real, local business proof instead of generic SEO copy.`
            : `This action is primarily technical. Real business proof can still make the affected page more useful and trustworthy.`,
          specStatus: creative?.status ?? "not_started",
          draftStatus: creativeDraft?.status ?? null,
          draftTitle: creativeDraft?.title ?? null,
          creativeAngle: creative?.creative_angle ?? null,
          verifiedProofCount: verifiedAssets.length,
          verifiedPhotoCount: verifiedPhotos.length,
          totalPhotoCount: assets.filter(
            (asset) => asset.proof_type === "photo" || text(asset.mime_type).startsWith("image/"),
          ).length,
          proofReady: verifiedAssets.length >= 2 && new Set(verifiedAssets.map((asset) => asset.proof_type)).size >= 2,
          canUpload: context.actorType === "client" ? ["client_admin"].includes(context.role) : true,
        },
        spend: {
          outcomeCapacitySource: reservation?.capacity_source ?? null,
          outcomeStatus: reservation?.status ?? null,
          outcomeCustomerAmount: (number(reservation?.customer_amount_cents) ?? 0) / 100,
          externalMonthlyCeiling: number(budgetResult.data?.monthly_limit) ?? 0,
          externalSpentThisMonth: +externalSpent.toFixed(2),
          externalTransactions: transactions.map((item) => ({
            id: item.id,
            category: item.category,
            provider: item.provider,
            description: item.description,
            amount: number(item.amount) ?? 0,
            currency: item.currency,
            approvalStatus: item.approval_status,
            occurredAt: item.occurred_at,
          })),
          explanation:
            "Your subscription covers the included agent outcome, implementation workflow, QA and monitoring. The external SEO spend ceiling is separate and is used only for itemized third-party costs you authorize.",
        },
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
