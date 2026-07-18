import "server-only";

import { inspectPublicPage } from "@/lib/crawler/site-crawler";
import { evaluateImplementationPage } from "@/lib/manual/live-verification-evaluator";

export async function verifyLiveImplementation(input:{liveUrl:string;packageData:unknown}){
  const page=await inspectPublicPage(input.liveUrl);
  return evaluateImplementationPage(page,input.packageData);
}
