import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // This app lives inside a larger repository. Pin both analyzers to the app so
  // unrelated lockfiles above it cannot change module resolution or tracing.
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
  // The RAG index and the raw knowledge files are read from disk at request time.
  // Trace them explicitly so serverless bundles (Vercel, etc.) include them.
  outputFileTracingIncludes: {
    "/api/chat": ["./data/**/*"],
    "/api/profile": ["./data/**/*"],
  },
};

export default nextConfig;
