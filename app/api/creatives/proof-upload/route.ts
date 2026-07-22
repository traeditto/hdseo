import{ApiError,jsonError}from"@/lib/api/errors";
import{requireLiveAgencyProject}from"@/lib/auth/live-tenant";
import{auditEvent,enforceRateLimit}from"@/lib/automation/control-plane";
import{addBusinessProof,verifyBusinessProof}from"@/lib/creatives/service";

const allowed=new Set(["image/jpeg","image/png","image/webp","audio/mpeg","audio/mp4","audio/wav","application/pdf"]);
export async function POST(request:Request){try{
  if(!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data"))throw new ApiError("Proof uploads must use multipart form data.",400,"VALIDATION_ERROR");
  const form=await request.formData(),projectId=String(form.get("projectId")??""),file=form.get("file");if(!(file instanceof File)||!projectId)throw new ApiError("Choose a proof file and client project.",400,"VALIDATION_ERROR");if(!allowed.has(file.type)||file.size>10*1024*1024)throw new ApiError("Proof files must be JPG, PNG, WebP, MP3, M4A, WAV, or PDF and no larger than 10 MB.",400,"VALIDATION_ERROR");
  const context=await requireLiveAgencyProject({projectId,permission:"seo.write"});
  const ownerAttested=context.actorType==="client";
  if(ownerAttested&&String(form.get("attestRights")??"")!=="yes")throw new ApiError("Confirm that you own this file or have permission to use it for the business.",400,"VALIDATION_ERROR");
  await enforceRateLimit(`agency:${context.agencyId}:project:${projectId}`,"proof_upload",30,3600);
  const extension=(file.name.split(".").pop()||"bin").replace(/[^a-z0-9]/gi,"").slice(0,8),path=`${context.agencyId}/${context.clientId}/${projectId}/${crypto.randomUUID()}.${extension}`;
  const upload=await context.db.storage.from("business-proof").upload(path,file,{contentType:file.type,upsert:false});if(upload.error)throw new ApiError("Proof storage is not ready. Apply migration 0018 and retry.",503,"DATABASE_BINDING_FAILED");
  const proof=await addBusinessProof(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId,userId:context.userId},{proofType:file.type.startsWith("audio/")?"voice_note":file.type.startsWith("image/")?"photo":"other",title:String(form.get("title")||file.name).slice(0,160),summary:String(form.get("summary")||"Uploaded business evidence").slice(0,5000),service:String(form.get("service")||"").slice(0,160),location:String(form.get("location")||"").slice(0,160),storagePath:path,mimeType:file.type});
  const verified=ownerAttested?await verifyBusinessProof(context.db,{agencyId:context.agencyId,clientId:context.clientId,projectId,userId:context.userId},proof.id,"verified"):proof;
  await auditEvent({agencyId:context.agencyId,actorUserId:context.userId,action:"creative.proof_uploaded",resourceType:"business_proof_asset",resourceId:proof.id,request,afterState:{projectId,mimeType:file.type,size:file.size,ownerAttested}});return Response.json({ok:true,proof:verified},{status:201});
}catch(error){return jsonError(error)}}
