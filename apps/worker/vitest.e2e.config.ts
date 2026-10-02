import { defineConfig } from "vitest/config";

try { process.loadEnvFile("../../.env"); } catch { /* CI sets env directly */ }

/** Needs the web app running at WEB_ORIGIN and local Supabase. `UPDATE_GOLDEN=1` rewrites reference PNGs. */
export default defineConfig({ test: { include: ["test-e2e/**/*.test.ts"], fileParallelism: false, testTimeout: 180_000, hookTimeout: 60_000 } });
