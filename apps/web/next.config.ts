import type { NextConfig } from "next";

// One .env at the repo root serves web, worker and db tooling.
try { process.loadEnvFile("../../.env"); } catch { /* env provided by the platform */ }

/**
 * Identifies this build to open tabs (GET /api/version, the update banner). The platform may pass
 * BUILD_ID (e.g. the git SHA); otherwise every build gets its own timestamp id. Nothing else leaks.
 */
// Written back to the environment so build workers that load this config again reuse the same id.
const buildId = (process.env.BUILD_ID = process.env.BUILD_ID?.trim().slice(0, 64) || Date.now().toString(36));

const config: NextConfig = {
  serverExternalPackages: ["pg-boss", "fontkit"],
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
};

export default config;
