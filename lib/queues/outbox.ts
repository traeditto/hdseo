import "server-only";
import {createHash} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {ApiError} from "@/lib/api/errors";
import {JobEnvelopeV2Schema,type JobEnvelopeV2,type JobKind} from "./contracts";

const topicByKind:Record<JobKind,string>={
  "webhook.process":"webhooks","evidence.sync":"evidence-sync","crawl.run":"crawls","agent.work":"agent-work",
  "deployment.create":"deployments","deployment.rollback":"deployments","notification.send":"notifications","report.generate":"reporting",
};

export function buildJobEnvelope(input:Omit<JobEnvelopeV2,"schemaVersion"|"createdAt">):JobEnvelopeV2{
  return JobEnvelopeV2Schema.parse({...input,schemaVersion:2,createdAt:new Date().toISOString()});
}

export async function writeOutbox(db:SupabaseClient,envelope:JobEnvelopeV2){
  const checked=JobEnvelopeV2Schema.parse(envelope),topic=topicByKind[checked.kind];
  const inserted=await db.from("queue_outbox").upsert({background_job_id:checked.jobId,topic,schema_version:2,envelope:checked,status:"pending",publish_after:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"background_job_id,topic"}).select("id,status").single();
  if(inserted.error||!inserted.data)throw new ApiError("The durable publish intent could not be recorded.",500,"DATABASE_BINDING_FAILED");
  return inserted.data;
}

export function requestFingerprint(value:unknown){return createHash("sha256").update(JSON.stringify(value)).digest("hex")}
