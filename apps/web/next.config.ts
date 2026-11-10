import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = process.env.NEXUS_STANDALONE === "1"
  ? { output: "standalone", outputFileTracingRoot: path.resolve(__dirname, "../..") }
  : {};

export default nextConfig;
