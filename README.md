# Chitrapx

AI-first App Store and Google Play screenshot generator (SaaS). Design: `docs/superpowers/specs/2026-10-02-chitrapx-design.md`.

## Local setup

Requires Node 24, pnpm 9, Docker.

```bash
pnpm i
pnpm db:start              # local Supabase (Postgres, Auth, Storage) in Docker
cp .env.example .env       # then paste ANON_KEY and SERVICE_ROLE_KEY from `pnpm exec supabase status`
pnpm db:migrate
pnpm db:seed               # loads the bundled templates
pnpm --filter @chitrapx/worker exec playwright install chromium   # for exports
pnpm dev                   # web on http://localhost:3000 + worker
```

Magic-link emails land in Mailpit at http://127.0.0.1:54324.

## Layout

- `apps/web` Next.js app (dashboard, auth, API routes)
- `apps/worker` pg-boss job runner
- `packages/db` Drizzle schema, RLS, credits, plans, onboarding, template seed
- `packages/document` document model, store size targets, retargeting, export plan, OSG template importer
- `packages/renderer` board renderer (ported from open-screenshot-generator, see NOTICES.md)
- `packages/assets` bundled template layouts and golden reference renders

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @chitrapx/worker test:e2e      # with `pnpm dev` running: real exports + golden images
UPDATE_GOLDEN=1 pnpm --filter @chitrapx/worker test:e2e   # after an intended visual change
```

## Deploy

Three pieces, all reading the same environment variables (see `.env.example`).

1. **Supabase** (cloud project)
   - Run migrations: `DATABASE_URL=<session pooler URL> pnpm db:migrate`.
   - Storage: private buckets `uploads` (25 MB file limit) and `exports` (500 MB).
   - Templates: `DATABASE_URL=... pnpm db:seed` after each release that changes `packages/assets/templates`.
   - Auth: set Site URL to the web origin, add `<origin>/auth/callback` to redirect URLs, enable the Google and GitHub providers.
2. **Web** (Vercel): project root `apps/web`, install command `pnpm install`, env `DATABASE_URL` (transaction pooler URL), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RENDER_SECRET`. Leave `ENABLE_DEV_TOOLS` unset.
3. **Worker** (Fly.io, Railway or any container host): `docker build -f apps/worker/Dockerfile .`, env `DATABASE_URL` (session pooler or direct URL, since pg-boss uses LISTEN/NOTIFY), `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RENDER_SECRET` (same value as the web app) and `WEB_ORIGIN`. It must run continuously; one instance processes 4 jobs per type at a time, add instances to scale.

Health check: `GET /api/health` returns `{ "db": "ok", "queue": "ok" }` or HTTP 503.
