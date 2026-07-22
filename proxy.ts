import { NextRequest, NextResponse } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SERVER_TO_SERVER_PREFIXES = [
  "/api/github/webhook",
  "/api/vercel/webhook",
  "/api/webhooks/github",
  "/api/webhooks/vercel",
  "/api/webhooks/attribution/",
  "/api/billing/webhook",
];

function isVerifiedServerToServerPath(pathname: string) {
  return SERVER_TO_SERVER_PREFIXES.some((prefix) =>
    prefix.endsWith("/") ? pathname.startsWith(prefix) : pathname === prefix,
  );
}

function denied(message: string) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "INVALID_ORIGIN",
        message,
        referenceId: crypto.randomUUID(),
      },
    },
    {
      status: 403,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export function proxy(request: NextRequest) {
  if (
    SAFE_METHODS.has(request.method) ||
    isVerifiedServerToServerPath(request.nextUrl.pathname)
  ) {
    return NextResponse.next();
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    return denied("Cross-site browser mutations are not allowed.");
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return denied("A verified same-origin request is required.");
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return denied("The request origin is invalid.");
  }

  if (parsedOrigin.origin !== request.nextUrl.origin) {
    return denied("The request origin does not match HD SEO.");
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
