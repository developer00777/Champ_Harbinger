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
    return [
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
