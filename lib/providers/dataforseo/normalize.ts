import type { DataForSeoEnvelope, NormalizedProviderResult } from "./types";

export class ProviderResponseError extends Error { constructor(message:string,public statusCode:number){super(message);this.name="ProviderResponseError";} }
export function normalizeEnvelope<T>(raw: DataForSeoEnvelope<T>): NormalizedProviderResult<T> {
  if (raw.status_code >= 40_000) throw new ProviderResponseError(raw.status_message || "The data provider rejected the request.",raw.status_code);
  const task = raw.tasks?.[0];
  if (task && task.status_code >= 40_000) throw new ProviderResponseError(task.status_message || "The provider task failed.",task.status_code);
  return { statusCode: raw.status_code, statusMessage: raw.status_message, taskId: task?.id ?? null, totalCost: raw.cost ?? task?.cost ?? 0, resultCount: task?.result_count ?? task?.result?.length ?? 0, results: task?.result ?? [] };
}
