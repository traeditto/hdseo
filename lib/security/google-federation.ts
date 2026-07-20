import "server-only";
import {ApiError} from "@/lib/api/errors";
import {env} from "@/lib/config/env";

export async function exchangeVercelOidcForGoogleAccessToken(vercelOidcToken:string){
  if(!env.GCP_PROJECT_NUMBER||!env.GCP_WORKLOAD_IDENTITY_POOL||!env.GCP_WORKLOAD_IDENTITY_PROVIDER)throw new ApiError("Google workload identity federation is not configured.",503,"NOT_CONFIGURED");
  const audience=`//iam.googleapis.com/projects/${env.GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${env.GCP_WORKLOAD_IDENTITY_POOL}/providers/${env.GCP_WORKLOAD_IDENTITY_PROVIDER}`;
  const exchange=await fetch("https://sts.googleapis.com/v1/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({audience,grant_type:"urn:ietf:params:oauth:grant-type:token-exchange",requested_token_type:"urn:ietf:params:oauth:token-type:access_token",scope:"https://www.googleapis.com/auth/cloud-platform",subject_token_type:"urn:ietf:params:oauth:token-type:jwt",subject_token:vercelOidcToken}),cache:"no-store",signal:AbortSignal.timeout(10_000)}),payload=await exchange.json() as {access_token?:string;expires_in?:number;error?:string};
  if(!exchange.ok||!payload.access_token)throw new ApiError("Google workload identity exchange failed.",502,"SECRET_PROVIDER_FAILED");
  if(!env.GCP_SERVICE_ACCOUNT_EMAIL)return{accessToken:payload.access_token,expiresIn:payload.expires_in??300};
  const impersonation=await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(env.GCP_SERVICE_ACCOUNT_EMAIL)}:generateAccessToken`,{method:"POST",headers:{authorization:`Bearer ${payload.access_token}`,"content-type":"application/json"},body:JSON.stringify({scope:["https://www.googleapis.com/auth/cloud-platform"],lifetime:"900s"}),cache:"no-store",signal:AbortSignal.timeout(10_000)}),result=await impersonation.json() as {accessToken?:string;expireTime?:string};
  if(!impersonation.ok||!result.accessToken)throw new ApiError("Google service identity could not be impersonated.",502,"SECRET_PROVIDER_FAILED");
  return{accessToken:result.accessToken,expiresIn:900};
}
