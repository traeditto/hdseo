import {z} from "zod";

export const jobKinds=["webhook.process","evidence.sync","crawl.run","agent.work","deployment.create","deployment.rollback","notification.send","report.generate"] as const;
export type JobKind=(typeof jobKinds)[number];

export const JobEnvelopeV2Schema=z.object({
  schemaVersion:z.literal(2),jobId:z.string().uuid(),kind:z.enum(jobKinds),
  tenant:z.object({agencyId:z.string().uuid(),clientId:z.string().uuid().nullable(),projectId:z.string().uuid().nullable()}),
  priority:z.number().int().min(0).max(100),idempotencyKey:z.string().min(12).max(300),
  trace:z.object({requestId:z.string().max(100),traceparent:z.string().max(200).nullable()}),
  deadline:z.string().datetime(),createdAt:z.string().datetime(),
}).strict();
export type JobEnvelopeV2=z.infer<typeof JobEnvelopeV2Schema>;

export type SecureRequestContext={
  requestId:string;traceId:string|null;user:{id:string;email:string};aal:"aal1"|"aal2";
  tenant:{agencyId:string;clientId:string|null;projectId:string|null};role:string;
  permissions:readonly string[];canonicalOrigin:string;
};

export type MutationIntentV2={
  actionDigest:string;policyVersion:string;evidenceDigest:string;reservedBudget:number;
  approvalIdentities:string[];validationContract:Record<string,unknown>;rollbackPlan:Record<string,unknown>;
};
