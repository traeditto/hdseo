"use client";

import { useEffect } from "react";

function csrfToken() {
  return document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("hdseo_csrf="))?.slice("hdseo_csrf=".length) ?? "";
}

/** Adds same-origin CSRF and idempotency proofs without exposing session data. */
export function SecureFetchBootstrap() {
  useEffect(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request?.url ?? String(input), window.location.href);
      const method = String(init?.method ?? request?.method ?? "GET").toUpperCase();
      if (url.origin !== window.location.origin || !["POST","PUT","PATCH","DELETE"].includes(method)) {
        return nativeFetch(input, init);
      }
      const headers = new Headers(request?.headers ?? init?.headers);
      const token = csrfToken();
      if (token) headers.set("x-csrf-token", token);
      if (!headers.has("idempotency-key")) headers.set("idempotency-key", crypto.randomUUID());
      return nativeFetch(input, {...init, headers});
    };
    return () => { window.fetch = nativeFetch; };
  }, []);
  return null;
}
