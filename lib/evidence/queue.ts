import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";

export type EvidenceJobType="google.search_analytics"|"google.sitemaps"|"google.url_inspection"|"crawler.crawl";
export async function enqueueEvidenceJob(db:SupabaseClient,input:{agencyId:string;clientId:string;projectId:string;websiteId?:string|null;connectionId?:string|null;jobType:EvidenceJobType;payload?:Record<string,unknown>;idempotencyKey:string;priority?:number}){
  const result=await db.rpc("enqueue_evidence_job",{p_agency_id:input.agencyId,p_client_organization_id:input.clientId,p_project_id:input.projectId,p_website_id:input.websiteId??null,p_source_connection_id:input.connectionId??null,p_job_type:input.jobType,p_payload:input.payload??{},p_idempotency_key:input.idempotencyKey,p_priority:input.priority??50});
  if(result.error||!result.data)throw new ApiError("The evidence collection job could not be queued. Apply migration 0016 and retry.",500,"DATABASE_BINDING_FAILED");
  return String(result.data);
}
