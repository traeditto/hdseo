import "server-only";
import { env, hasDataForSeoConfig } from "@/lib/config/env";
import { ApiError } from "@/lib/api/errors";
import type { DataForSeoEnvelope, NormalizedProviderResult } from "./types";
import { normalizeEnvelope, ProviderResponseError } from "./normalize";

const BASE_URL = "https://api.dataforseo.com/v3";

function authorizationHeader() {
  return `Basic ${Buffer.from(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`).toString("base64")}`;
}

export async function dataForSeoRequest<T>(path: string, body: unknown, tag: string): Promise<NormalizedProviderResult<T>> {
  if (!hasDataForSeoConfig) throw new ApiError("DataForSEO is not configured.", 503, "NOT_CONFIGURED");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${BASE_URL}${path}`, { method: "POST", headers: { Authorization: authorizationHeader(), "Content-Type": "application/json", "X-Request-Tag": tag }, body: JSON.stringify(body), signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new ApiError(`DataForSEO request failed with HTTP ${response.status}.`, 502, "OPERATION_FAILED");
    return normalizeEnvelope(await response.json() as DataForSeoEnvelope<T>);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof ProviderResponseError) throw new ApiError(error.message, 502, "OPERATION_FAILED");
    if (error instanceof Error && error.name === "AbortError") throw new ApiError("DataForSEO timed out.", 504, "OPERATION_FAILED");
    throw new ApiError("DataForSEO could not be reached.", 502, "OPERATION_FAILED");
  } finally { clearTimeout(timer); }
}

export async function dataForSeoGet<T>(path: string, tag: string): Promise<NormalizedProviderResult<T>> {
  if (!hasDataForSeoConfig) throw new ApiError("DataForSEO is not configured.", 503, "NOT_CONFIGURED");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: { Authorization: authorizationHeader(), "Content-Type": "application/json", "X-Request-Tag": tag },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new ApiError(`DataForSEO request failed with HTTP ${response.status}.`, 502, "OPERATION_FAILED");
    return normalizeEnvelope(await response.json() as DataForSeoEnvelope<T>);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof ProviderResponseError) throw new ApiError(error.message, 502, "OPERATION_FAILED");
    if (error instanceof Error && error.name === "AbortError") throw new ApiError("DataForSEO timed out.", 504, "OPERATION_FAILED");
    throw new ApiError("DataForSEO could not be reached.", 502, "OPERATION_FAILED");
  } finally { clearTimeout(timer); }
}
