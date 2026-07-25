import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" packages a self-contained server.js for the Docker image
  // (Dockerfile copies .next/standalone — see docs/DEPLOY-RAILWAY.md and
  // docs/DEPLOY-COOLIFY-VERCEL.md). Vercel has its own build/trace pipeline
  // and sets VERCEL=1 at build time; skip "standalone" there so the same
  // config serves both deploy targets without extra, unused tracing work.
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  async rewrites() {
    // Split deploy: Vercel serves the UI, a Coolify container serves the API.
    // When HARBINGER_API_ORIGIN is set, /api/* is proxied to that origin
    // instead of being handled locally. The API host itself leaves the var
    // UNSET so it keeps serving its own routes — otherwise it would proxy to
    // itself and loop. See docs/DEPLOY-COOLIFY-VERCEL.md.
    //
    // Every /api/* route proxies, including /api/metrics — the API host is the
    // only process touching Postgres and pg-boss, so it is the only one whose
    // metrics mean anything. Check the frontend's own liveness with "/".
    const apiOrigin = process.env.HARBINGER_API_ORIGIN?.replace(/\/+$/, "");
    const apiProxy = apiOrigin
      ? [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }]
      : [];

    return [
      ...apiProxy,
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
