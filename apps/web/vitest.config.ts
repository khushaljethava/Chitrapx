import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

try { process.loadEnvFile("../../.env"); } catch { /* CI sets env directly */ }

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { fileParallelism: false, testTimeout: 20_000 },
});
