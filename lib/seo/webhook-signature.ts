import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
export function verifyWebhookSignature(body: string, signature: string | null, secret: string | undefined, prefix = "", algorithm: "sha1"|"sha256" = "sha256") { if (!signature || !secret) return false; const expected = `${prefix}${createHmac(algorithm, secret).update(body).digest("hex")}`, left = Buffer.from(signature), right = Buffer.from(expected); return left.length === right.length && timingSafeEqual(left, right); }
