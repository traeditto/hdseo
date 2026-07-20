import "server-only";
import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
import {ApiError} from "@/lib/api/errors";
import {env} from "@/lib/config/env";

export type SecretEnvelopeV2={
  version:2;kmsKeyVersion:string;wrappedDataKey:string;iv:string;tag:string;ciphertext:string;
  aad:{agencyId:string;clientId:string|null;projectId:string|null;purpose:string};aadDigest:string;
};

function b64(value:Buffer){return value.toString("base64")}
function kmsKey(){if(!env.GCP_KMS_CONNECTOR_KEY)throw new ApiError("Cloud KMS connector key is not configured.",503,"NOT_CONFIGURED");return env.GCP_KMS_CONNECTOR_KEY}
async function kmsCall<T>(operation:"encrypt"|"decrypt",body:Record<string,string>,accessToken:string){
  const response=await fetch(`https://cloudkms.googleapis.com/v1/${kmsKey()}:${operation}`,{method:"POST",headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json"},body:JSON.stringify(body),cache:"no-store",signal:AbortSignal.timeout(10_000)});
  const payload=await response.json() as T&{error?:{message?:string}};
  if(!response.ok)throw new ApiError(`Cloud KMS ${operation} failed.`,502,"SECRET_PROVIDER_FAILED");
  return payload;
}

export async function encryptSecretEnvelope(plainText:string,aad:SecretEnvelopeV2["aad"],googleAccessToken:string):Promise<SecretEnvelopeV2>{
  const aadBytes=Buffer.from(JSON.stringify(aad)),dataKey=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",dataKey,iv);cipher.setAAD(aadBytes);
  const ciphertext=Buffer.concat([cipher.update(plainText,"utf8"),cipher.final()]),tag=cipher.getAuthTag();
  const wrapped=await kmsCall<{ciphertext:string;name?:string}>("encrypt",{plaintext:b64(dataKey),additionalAuthenticatedData:b64(aadBytes)},googleAccessToken);
  const digest=await crypto.subtle.digest("SHA-256",aadBytes);
  dataKey.fill(0);
  return{version:2,kmsKeyVersion:wrapped.name??kmsKey(),wrappedDataKey:wrapped.ciphertext,iv:b64(iv),tag:b64(tag),ciphertext:b64(ciphertext),aad,aadDigest:Buffer.from(digest).toString("hex")};
}

export async function decryptSecretEnvelope(envelope:SecretEnvelopeV2,expectedAad:SecretEnvelopeV2["aad"],googleAccessToken:string){
  if(envelope.version!==2||JSON.stringify(envelope.aad)!==JSON.stringify(expectedAad))throw new ApiError("Secret tenant binding is invalid.",403,"TENANT_DENIED");
  const aadBytes=Buffer.from(JSON.stringify(expectedAad)),unwrapped=await kmsCall<{plaintext:string}>("decrypt",{ciphertext:envelope.wrappedDataKey,additionalAuthenticatedData:b64(aadBytes)},googleAccessToken),dataKey=Buffer.from(unwrapped.plaintext,"base64");
  try{const decipher=createDecipheriv("aes-256-gcm",dataKey,Buffer.from(envelope.iv,"base64"));decipher.setAAD(aadBytes);decipher.setAuthTag(Buffer.from(envelope.tag,"base64"));return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,"base64")),decipher.final()]).toString("utf8");}
  catch{throw new ApiError("Stored integration secret could not be decrypted.",500,"SECRET_PROVIDER_FAILED");}
  finally{dataKey.fill(0)}
}
