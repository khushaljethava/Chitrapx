import { defineConfig } from "vitest/config";

try { process.loadEnvFile("../../.env"); } catch { /* CI sets env directly */ }

export default defineConfig({ test: { include: ["test/**/*.test.ts"], fileParallelism: false, testTimeout: 20_000 } });
