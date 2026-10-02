import { defineConfig } from "drizzle-kit";

try { process.loadEnvFile("../../.env"); } catch { /* env provided by the shell */ }

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL! },
  schemaFilter: ["public"],
  entities: { roles: { provider: "supabase" } },
});
