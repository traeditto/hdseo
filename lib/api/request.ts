import "server-only";
import { z } from "zod";
import { ApiError } from "./errors";

export async function parseJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  const result = schema.safeParse(await request.json().catch(() => null));
  if (!result.success) throw new ApiError("The request is invalid.", 400, "VALIDATION_ERROR");
  return result.data;
}

export async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new ApiError(message, 504, "OPERATION_FAILED")), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}
