import type { NextConfig } from "next";

// One .env at the repo root serves web, worker and db tooling.
try { process.loadEnvFile("../../.env"); } catch { /* env provided by the platform */ }

const config: NextConfig = {
  serverExternalPackages: ["pg-boss", "fontkit"],
};

export default config;
