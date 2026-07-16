const blockedKeys=/^(authorization|token|access_token|refresh_token|secret|client_secret|private_key)$/i;
export function sanitizeWebhookPayload(value:unknown,depth=0):unknown{
  if(depth>12)return "[truncated]";
  if(Array.isArray(value))return value.slice(0,500).map(item=>sanitizeWebhookPayload(item,depth+1));
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).slice(0,500).map(([key,item])=>[key,blockedKeys.test(key)?"[redacted]":sanitizeWebhookPayload(item,depth+1)]));
  if(typeof value==="string"&&value.length>20_000)return `${value.slice(0,20_000)}[truncated]`;
  return value;
}
