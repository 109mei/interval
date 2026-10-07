import assets from "virtual:interval-assets";
import { handleApi, cleanup } from "./api";
import type { Env } from "./db";
let lastCleanup = 0;
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx?: { waitUntil(p: Promise<unknown>): void },
  ) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/")) {
      if (env.DB && Date.now() - lastCleanup > 60000) {
        lastCleanup = Date.now();
        ctx?.waitUntil(cleanup(env.DB, Date.now()).catch(() => {}));
      }
      return handleApi(request, env);
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", { status: 405 });
    const asset = assets[path === "/" ? "/index.html" : path];
    const response = asset
      ? new Response(request.method === "HEAD" ? null : asset.body, {
          headers: {
            "Content-Type": asset.type,
            "Cache-Control": path.startsWith("/assets/")
              ? "public, max-age=31536000, immutable"
              : "no-cache",
          },
        })
      : new Response("Not found", { status: 404 });
    const headers = new Headers(response.headers);
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com",
    );
    return new Response(response.body, { status: response.status, headers });
  },
};
