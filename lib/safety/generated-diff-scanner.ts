import {ApiError} from "@/lib/api/errors";

const forbiddenPaths=[/^\.github\//,/^\.env(?:\.|$)/,/^supabase\/migrations\//,/^(?:terraform|infra)\//,/(?:^|\/)package(?:-lock)?\.json$/,/pnpm-lock\.yaml$/,/yarn\.lock$/];
const secretPatterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bAKIA[0-9A-Z]{16}\b/,/\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,/\bgh[opsu]_[A-Za-z0-9_]{20,}\b/,/SUPABASE_SERVICE_ROLE_KEY\s*[:=]/i,/APP_ENCRYPTION_KEY\s*[:=]/i];
const unsafePatterns=[/\b(?:eval|Function)\s*\(/,/from\s+["'](?:node:)?child_process["']/,/require\s*\(\s*["'](?:node:)?child_process["']\s*\)/,/curl\s+[^\n|]*\|\s*(?:sh|bash)/i,/\b(?:xmrig|cryptonight|stratum\+tcp)\b/i];

export function scanGeneratedDiff(files:Array<{path:string;content:string}>){
  if(!files.length||files.length>20)throw new ApiError("Generated change exceeds the 20-file safety limit.",409,"GENERATED_DIFF_REJECTED");
  let bytes=0;
  for(const file of files){
    const path=file.path.replaceAll("\\","/");bytes+=Buffer.byteLength(file.content,"utf8");
    if(path.startsWith("/")||path.split("/").includes("..")||forbiddenPaths.some(pattern=>pattern.test(path)))throw new ApiError(`Generated changes cannot modify ${path}.`,409,"GENERATED_DIFF_REJECTED");
    if(file.content.includes("\u0000")||secretPatterns.some(pattern=>pattern.test(file.content)))throw new ApiError(`Generated content for ${path} contains secret-like material.`,409,"GENERATED_DIFF_REJECTED");
    if(unsafePatterns.some(pattern=>pattern.test(file.content)))throw new ApiError(`Generated content for ${path} contains a forbidden execution pattern.`,409,"GENERATED_DIFF_REJECTED");
  }
  if(bytes>500_000)throw new ApiError("Generated change exceeds the 500 KB safety limit.",409,"GENERATED_DIFF_REJECTED");
  return{files:files.length,bytes,passed:true};
}
