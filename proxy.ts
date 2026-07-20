import { NextRequest, NextResponse } from "next/server";

const CANONICAL_ORIGIN = "https://hdseo.vercel.app";
const CSRF_COOKIE = "hdseo_csrf";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PROVIDER_CALLBACK_PREFIXES = [
  "/api/github/webhook",
  "/api/vercel/webhook",
  "/api/stripe/webhook",
  "/api/webhooks/",
  "/api/attribution/webhook",
  "/api/cron/",
];

function isProviderCallback(pathname: string) {
  return PROVIDER_CALLBACK_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function isPrivilegedPath(pathname: string) {
  return pathname === "/login" || pathname.startsWith("/login/") || pathname === "/portal" ||
    pathname.startsWith("/portal/") || pathname === "/admin" || pathname.startsWith("/admin/") ||
    pathname === "/api" || pathname.startsWith("/api/") || pathname.startsWith("/reset-password");
}

function error(code: string, message: string, status: number, requestId: string) {
  return NextResponse.json({ok:false,error:{code,message,referenceId:requestId}}, {
    status,
    headers:{"cache-control":"no-store","x-request-id":requestId},
  });
}

function contentSecurityPolicy(nonce: string) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com",
    "form-action 'self' https://github.com https://accounts.google.com https://checkout.stripe.com",
    "frame-src https://challenges.cloudflare.com https://checkout.stripe.com",
    "upgrade-insecure-requests",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id")?.slice(0, 100) || crypto.randomUUID();
  const pathname = request.nextUrl.pathname;
  const host = request.headers.get("host")?.toLowerCase();

  if (process.env.VERCEL && isPrivilegedPath(pathname) && host && host !== "hdseo.vercel.app") {
    return NextResponse.redirect(new URL(`${pathname}${request.nextUrl.search}`, CANONICAL_ORIGIN), 307);
  }

  if (process.env.VERCEL && (request.headers.has("oai-authenticated-user-email") || request.headers.has("oai-authenticated-user-full-name"))) {
    return error("UNTRUSTED_IDENTITY_HEADER", "This identity mechanism is not accepted on the canonical application.", 400, requestId);
  }

  if (pathname.startsWith("/api/") && MUTATING_METHODS.has(request.method)) {
    const contentLength = Number(request.headers.get("content-length") || "0");
    const maxBytes = isProviderCallback(pathname)||pathname.includes("proof-upload") ? 1_048_576 : 65_536;
    if (!Number.isFinite(contentLength) || contentLength > maxBytes) {
      return error("PAYLOAD_TOO_LARGE", "The request body exceeds the permitted size.", 413, requestId);
    }
    if (!contentLength) {
      const body = await request.clone().arrayBuffer();
      if (body.byteLength > maxBytes) return error("PAYLOAD_TOO_LARGE", "The request body exceeds the permitted size.", 413, requestId);
    }

    if (!isProviderCallback(pathname) && !request.headers.get("idempotency-key")?.match(/^[A-Za-z0-9._:-]{12,200}$/)) {
      return error("IDEMPOTENCY_KEY_REQUIRED", "This action requires a valid idempotency key.", 400, requestId);
    }

    if (!isProviderCallback(pathname)) {
      const origin = request.headers.get("origin");
    const permittedOrigin = process.env.VERCEL ? CANONICAL_ORIGIN : request.nextUrl.origin;
    if (!origin || origin !== permittedOrigin) {
      return error("ORIGIN_FORBIDDEN", "Cross-origin mutations are not permitted.", 403, requestId);
    }
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin") {
      return error("FETCH_CONTEXT_FORBIDDEN", "The request fetch context is not permitted.", 403, requestId);
    }

    const cookieToken = request.cookies.get(CSRF_COOKIE)?.value;
    const headerToken = request.headers.get("x-csrf-token");
    if (!cookieToken || !headerToken || cookieToken.length < 32 || cookieToken !== headerToken) {
      return error("CSRF_INVALID", "Refresh the page and try again.", 403, requestId);
    }
    }
  }

  const nonce = crypto.randomUUID().replaceAll("-", "");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", contentSecurityPolicy(nonce));
  const response = NextResponse.next({request:{headers:requestHeaders}});
  response.headers.set("content-security-policy", contentSecurityPolicy(nonce));
  response.headers.set("x-request-id", requestId);
  if (pathname.startsWith("/api/")) response.headers.set("cache-control", "no-store");
  if (!request.cookies.get(CSRF_COOKIE)) {
    response.cookies.set(CSRF_COOKIE, crypto.randomUUID(), {
      sameSite:"strict", secure:request.nextUrl.protocol === "https:", path:"/", httpOnly:false,
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
