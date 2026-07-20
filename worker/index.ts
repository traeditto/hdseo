/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { setRuntimeEnvironment } from "../db";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    setRuntimeEnvironment(env);
    const url = new URL(request.url);

    const privileged = url.pathname === "/login" ||
      url.pathname.startsWith("/login/") ||
      url.pathname === "/portal" ||
      url.pathname.startsWith("/portal/") ||
      url.pathname === "/admin" ||
      url.pathname.startsWith("/admin/") ||
      url.pathname === "/api" ||
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/reset-password") ||
      url.pathname.startsWith("/signin-with-chatgpt") ||
      url.pathname.startsWith("/signout-with-chatgpt") ||
      url.pathname.startsWith("/callback");
    if (privileged) {
      const canonical = new URL(`${url.pathname}${url.search}`, "https://hdseo.vercel.app");
      return Response.redirect(canonical, 307);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
