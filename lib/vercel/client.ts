import "server-only";
import { ApiError } from "@/lib/api/errors";

const API = "https://api.vercel.com";
export interface VercelCredentials { token: string; teamId?: string | null; teamSlug?: string | null }

function withScope(path: string, credentials: VercelCredentials) {
  const url = new URL(path, API);
  if (credentials.teamId) url.searchParams.set("teamId", credentials.teamId);
  else if (credentials.teamSlug) url.searchParams.set("slug", credentials.teamSlug);
  return url;
}

export async function vercelRequest<T>(path: string, credentials: VercelCredentials, options: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(withScope(path, credentials), {
      ...options, cache: "no-store", signal: controller.signal,
      headers: { Authorization: `Bearer ${credentials.token}`, Accept: "application/json", "Content-Type": "application/json", ...(options.headers ?? {}) },
    });
    if (!response.ok) {
      const providerRequestId = response.headers.get("x-vercel-id") ?? undefined;
      const providerCode = await response.json().then((value: { error?: { code?: string } }) => value.error?.code).catch(() => undefined);
      const safeStatus = response.status === 404 || response.status === 409 || response.status === 429 ? response.status : 502;
      throw new ApiError(`Vercel request failed with HTTP ${response.status}${providerCode ? ` (${providerCode})` : ""}.`, safeStatus, response.status === 429 ? "RATE_LIMITED" : response.status === 404 ? "NOT_FOUND" : response.status === 409 ? "CONFLICT" : "OPERATION_FAILED", providerRequestId);
    }
    if (response.status === 204 || response.headers.get("content-length") === "0") return undefined as T;
    return await response.json() as T;
  } finally { clearTimeout(timer); }
}

export interface VercelProject { id: string; name: string; framework?: string | null; link?: { type?:string;org?:string;repo?:string;repoId?:number;productionBranch?: string }; accountId?: string }
export function getVercelProject(credentials: VercelCredentials, idOrName: string) {
  return vercelRequest<VercelProject>(`/v9/projects/${encodeURIComponent(idOrName)}`, credentials);
}
export function createVercelProject(credentials: VercelCredentials, input: { name: string; repository: string; framework?: string; rootDirectory?: string }) {
  return vercelRequest<VercelProject>("/v11/projects", credentials, { method: "POST", body: JSON.stringify({ name: input.name, framework: input.framework, rootDirectory: input.rootDirectory || null, gitRepository: { type: "github", repo: input.repository } }) });
}
export function addVercelProjectDomain(credentials:VercelCredentials,projectId:string,domain:string){return vercelRequest<{name:string;verified:boolean;verification?:Array<{type:string;domain:string;value:string;reason:string}>}>(`/v10/projects/${encodeURIComponent(projectId)}/domains`,credentials,{method:"POST",body:JSON.stringify({name:domain})})}
export function listVercelProjectDomains(credentials:VercelCredentials,projectId:string){return vercelRequest<{domains:Array<{name:string;verified:boolean;verification?:Array<{type:string;domain:string;value:string;reason:string}>}>}>(`/v9/projects/${encodeURIComponent(projectId)}/domains`,credentials)}

export interface VercelDeployment { id: string; url: string; readyState?: string; target?: string; meta?: Record<string, string>; createdAt?: number; ready?: number }
export function createVercelDeployment(credentials: VercelCredentials, input: { projectId: string; projectName: string; repositoryId: number|string; ref: string; sha?: string; environment: "preview" | "staging" | "production"; metadata: Record<string, string> }) {
  return vercelRequest<VercelDeployment>("/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1", credentials, { method: "POST", body: JSON.stringify({
    name: input.projectName, project: input.projectId, target: input.environment === "preview" ? undefined : input.environment,
    gitSource: { type: "github", repoId: input.repositoryId, ref: input.ref, ...(input.sha ? { sha: input.sha } : {}) }, meta: input.metadata,
  }) });
}
export function getVercelDeployment(credentials: VercelCredentials, idOrUrl: string) {
  return vercelRequest<VercelDeployment>(`/v13/deployments/${encodeURIComponent(idOrUrl)}`, credentials);
}
export function getVercelDeploymentEvents(credentials: VercelCredentials, deploymentId: string) {
  return vercelRequest<Array<{ id?: string; type?: string; text?: string; created?: number; date?: number }>>(`/v3/deployments/${encodeURIComponent(deploymentId)}/events?follow=0&direction=forward&limit=1000`, credentials);
}
export function rollbackVercelProject(credentials: VercelCredentials, projectId: string, deploymentId: string, description: string) {
  const path = `/v1/projects/${encodeURIComponent(projectId)}/rollback/${encodeURIComponent(deploymentId)}?description=${encodeURIComponent(description)}`;
  return vercelRequest<void>(path, credentials, { method: "POST" });
}
export function promoteVercelDeployment(credentials: VercelCredentials, projectId: string, deploymentId: string) {
  return vercelRequest<void>(`/v10/projects/${encodeURIComponent(projectId)}/promote/${encodeURIComponent(deploymentId)}`, credentials, { method: "POST" });
}

export async function exchangeVercelCode(code: string, clientId: string, clientSecret: string) {
  const response = await fetch(`${API}/v2/oauth/access_token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: "https://hdseo.vercel.app/api/vercel/connect" }), cache: "no-store" });
  if (!response.ok) throw new ApiError("Vercel authorization could not be completed.", 502, "OPERATION_FAILED");
  return await response.json() as { access_token: string; team_id?: string; user_id?: string; token_type?: string };
}
