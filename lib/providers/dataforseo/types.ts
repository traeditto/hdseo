export interface DataForSeoTask<T> { id?: string; status_code: number; status_message: string; cost?: number; time?: string; result_count?: number; result?: T[] }
export interface DataForSeoEnvelope<T> { status_code: number; status_message: string; cost?: number; time?: string; tasks?: DataForSeoTask<T>[] }
export interface NormalizedProviderResult<T> { statusCode: number; statusMessage: string; taskId: string | null; totalCost: number; resultCount: number; results: T[] }
export type ProviderOperation = "keyword_overview" | "ranked_keywords" | "competitor_discovery" | "relevant_pages";
