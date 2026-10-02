# Chitrapx

AI-first App Store and Google Play screenshot generator (SaaS). Design: `docs/superpowers/specs/2026-10-02-chitrapx-design.md`.

## Local setup

Requires Node 24, pnpm 9, Docker.

```bash
pnpm i
pnpm db:start              # local Supabase (Postgres, Auth, Storage) in Docker
cp .env.example .env       # then paste ANON_KEY and SERVICE_ROLE_KEY from `pnpm exec supabase status`
pnpm db:migrate
pnpm dev                   # web on http://localhost:3000 + worker
```

Magic-link emails land in Mailpit at http://127.0.0.1:54324.

## Layout

- `apps/web` Next.js app (dashboard, auth, API routes)
- `apps/worker` pg-boss job runner
- `packages/db` Drizzle schema, RLS, credits, plans, onboarding

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test
```
