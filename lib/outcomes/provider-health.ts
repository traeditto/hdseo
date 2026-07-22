export const OUTCOME_SYNC_INTERVAL_MS=6*60*60*1000;
const MAX_PROVIDER_BACKOFF_MS=6*60*60*1000;

export function providerSyncBackoffMs(consecutiveFailures:number){
  const steps=[5*60*1000,15*60*1000,60*60*1000,3*60*60*1000,MAX_PROVIDER_BACKOFF_MS];
  return steps[Math.min(Math.max(0,consecutiveFailures-1),steps.length-1)];
}

export function nextProviderSyncAt(now:Date,consecutiveFailures=0){
  return new Date(now.getTime()+(consecutiveFailures?providerSyncBackoffMs(consecutiveFailures):OUTCOME_SYNC_INTERVAL_MS)).toISOString();
}

export function providerResourceNeedsDiscovery(input:{provider:string;selected_resource?:string|null;metadata?:Record<string,unknown>|null}){
  if(input.provider!=="google_analytics"&&input.provider!=="google_business_profile")return false;
  const health=typeof input.metadata?.health==="string"?input.metadata.health:"unknown";
  if(!input.selected_resource||health==="discovery_pending"||health==="discovery_failed")return true;
  return input.provider==="google_business_profile"&&!input.metadata?.selectedAccount;
}
