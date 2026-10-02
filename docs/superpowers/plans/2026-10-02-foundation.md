# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real SaaS shell: sign up, get a workspace with 50 credits, create apps (with brand kit) and projects, upload screenshots, and prove the job queue + credit reserve/refund end to end with a `noop` job.

**Architecture:** pnpm monorepo. `packages/db` owns schema, RLS, credits, plans, onboarding. `apps/web` (Next.js 16) does auth via Supabase and all mutations through route handlers that call small service modules. `apps/worker` consumes pg-boss jobs from the same Postgres.

**Tech Stack:** Node 24, pnpm 9, TypeScript strict, Next.js 16, Tailwind 4, Supabase (Auth, Postgres, Storage, CLI 2.x), Drizzle ORM + drizzle-kit on `pg`, pg-boss 12, Zod 4, Vitest, file-type, image-size.

**Spec:** `docs/superpowers/specs/2026-10-02-chitrapx-design.md` (Part A + Part B)

## Global Constraints

- TypeScript `strict: true` everywhere. ESM only (`"type": "module"`).
- All DB access through Drizzle on `pg`; transactions through `withTx` (Task 2) so pg-boss can enqueue on the same connection.
- Every non-`profiles`/`templates` table has `workspace_id`; RLS enabled on every public table.
- `jobs` and `credit_ledger` are read-only to `authenticated`; only the server (service connection) writes them.
- Prices only in `packages/db/src/pricing.ts` (`noop: 1`). Plans only in `packages/db/src/plans.ts` (free 50/1 app/3 projects; pro 1,000/10/unlimited; studio 5,000/unlimited/unlimited).
- Upload limits: image 25 MB, recording 500 MB, font 10 MB. MIME sniffed server-side. Foundation accepts `image/png`, `image/jpeg`, `image/webp` for `screenshot` and `image` kinds; SVG is rejected until sanitizing lands.
- Check order in every route: authenticated, workspace member, plan limit, input valid.
- Job retries: `retryLimit: 3`, `retryDelay: 2`, `retryBackoff: true`. `MAX_ATTEMPTS = 4`.
- Mutations return HTTP status codes: 400 invalid, 401 unauthenticated, 402 insufficient credits, 403 plan limit, 404 missing or foreign, 409 conflict, 413 too large.
- No em dashes or en dashes in user-facing copy.

## Review Focus

1. **Retry after crash:** a job redelivered after its handler ran must not settle or refund twice. Pinned by the unique `(job_id, reason)` ledger test in Task 3 and the "re-run done job" test in Task 5.
2. **Concurrent onboarding:** two callback hits for a new user (double-clicked magic link) yield one workspace and one grant. Pinned by the parallel `ensureWorkspace` test in Task 4.
3. **Grant day on short months:** a workspace created on the 31st gets its February grant on the 28th. Pinned by `isGrantDay` tests in Task 4.
4. **Lying client on upload:** declared size/MIME/sha256 differ from the real bytes; server rejects and removes the object. Pinned by `completeUpload` tests in Task 7.
5. **Cross-workspace ids in URLs:** a member of A passing B's `appId`/`projectId` gets 404, never B's data. Pinned by service tests in Tasks 6 and 7.

---

## File Structure

```
Chitrapx/
  package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.js  .gitignore  .env.example
  README.md  NOTICES.md  .github/workflows/ci.yml
  supabase/config.toml                       (supabase init; uploads bucket)
  packages/db/
    src/index.ts        re-exports
    src/schema.ts       all tables (A4)
    src/client.ts       pool, db, withTx, Tx, Db
    src/plans.ts        PLANS, Plan
    src/pricing.ts      PRICES, JobType
    src/credits.ts      balance, reserveAndEnqueue, settle, refund, InsufficientCreditsError
    src/onboarding.ts   ensureWorkspace
    src/grants.ts       isGrantDay, grantMonthlyCredits
    src/doc.ts          emptyDoc, docSchema (minimal)
    migrations/         drizzle-kit output + custom rls migration
    test/helpers.ts     createUser, asUser, makeWorkspace
    test/*.test.ts
  apps/worker/
    src/index.ts        boss start, queues, work, schedule, SIGTERM
    src/runJob.ts       runJob, FatalJobError, MAX_ATTEMPTS
    src/handlers.ts     noop
    test/runJob.test.ts
    Dockerfile
  apps/web/
    src/proxy.ts
    src/lib/supabase/{server.ts,browser.ts,admin.ts}
    src/server/{http.ts,context.ts,apps.ts,projects.ts,uploads.ts,storage.ts,jobs.ts,boss.ts}
    src/app/login, src/app/auth/callback, src/app/dashboard, src/app/api/...
    src/components/...
    test/*.test.ts
```

---

### Task 1: Monorepo scaffold + local Supabase

- [x] `pnpm-workspace.yaml` with `apps/*`, `packages/*`. Root scripts: `typecheck`, `lint`, `test`, `db:start`, `db:migrate`.
- [x] `tsconfig.base.json`: `strict`, `target ES2023`, `module ESNext`, `moduleResolution Bundler`, `noUncheckedIndexedAccess`, `skipLibCheck`.
- [x] ESLint flat config with `typescript-eslint` recommended.
- [x] `supabase init`; add private `uploads` bucket (500MiB limit) in `supabase/config.toml`; `supabase start`.
- [x] `.env.example`, `NOTICES.md`, `README.md` setup section.
- [x] Commit `chore: scaffold monorepo and local supabase`.

### Task 2: Schema, client, migrations

**Produces:** `pool`, `db: Db`, `type Tx = { db: Db; client: pg.PoolClient }`, `withTx<T>(fn: (tx: Tx) => Promise<T>)`; all A4 tables (assets unique `(workspaceId, appId, sha256)` nulls not distinct; ledger unique `(jobId, reason)`; app FKs cascade); `emptyDoc(kind)`.

- [x] Test: duplicate `(workspace, app, sha)` throws; different app succeeds; both-null app twice throws.
- [x] FAIL → implement → `drizzle-kit generate` + `migrate` → PASS. Commit `feat(db): schema, client, migrations`.

### Task 3: RLS + credits + pricing + plans

**Produces:** `PRICES`, `JobType`, `PLANS`, `Plan`, `InsufficientCreditsError`, `balance(db, ws)`, `reserveAndEnqueue(tx, boss, { workspaceId, projectId?, type, input })` (advisory lock, job + reserve rows, balance check, `boss.send` on `tx.client`), `settle(db, jobId, actual)`, `refund(db, jobId)` (both idempotent via unique index).

RLS: `is_member(ws)` security definer; member `for all` on `apps, projects, project_versions, assets`; `workspaces` select/update; `memberships, jobs, credit_ledger` select only; `profiles` own row; `templates` select.

- [x] Tests (`rls.test.ts`): for every table A reading B → 0 rows; A inserting with B's id → throws; A updating/deleting B → 0 rows; A inserting ledger/jobs for own workspace → throws.
- [x] Tests (`credits.test.ts`): grant 50 → 50; reserve -1; refund restores; double refund idempotent; balance 0 → error and no job row; two parallel reserves at balance 1 → exactly one job.
- [x] FAIL → implement → PASS. Commit `feat(db): rls, credit ledger, plans, pricing`.

### Task 4: Onboarding + monthly grants

**Produces:** `ensureWorkspace(user) → { workspaceId, created }` (advisory lock on user id); `isGrantDay(createdAt, today)` (UTC, clamps to month end); `grantMonthlyCredits(today) → number` (top up to allowance, once per `YYYY-MM`).

- [x] Tests: second call same workspace, one grant; parallel calls → one workspace; `isGrantDay` Jan 31 → Feb 28 true, Feb 27 false; grant twice in a month → once; balance 10 → +40; balance 60 → 0 marker row.
- [x] FAIL → implement → PASS. Commit `feat(db): onboarding and monthly grants`.

### Task 5: Worker

**Produces:** `FatalJobError`, `MAX_ATTEMPTS = 4`, `runJob(jobId, handler)`; `noop` handler; `index.ts` with queues, schedule `0 3 * * *`, graceful SIGTERM; Dockerfile.

- [x] Tests: success → done, net -1; fatal → failed, balance restored; transient attempt 1 rethrows; transient attempt 4 → failed + refund; done job re-run is a no-op.
- [x] FAIL → implement → PASS. Commit `feat(worker): job runner, noop, monthly grant schedule`.

### Task 6: Web app, auth, apps and projects

**Produces:** `HttpError`, `route(fn)`, `requireContext()`, app and project services (404 on foreign ids, 403 `plan_limit`), Supabase auth (magic link, Google, GitHub), proxy session refresh + `/dashboard` guard, callback → `ensureWorkspace`.

- [x] Tests: free 2nd app → 403; foreign app id → 404 on update/delete/createProject; 4th project → 403; new project doc equals `emptyDoc(kind)`, revision 0; bad hex colour → 400.
- [x] FAIL → implement → PASS; `next build` succeeds. Commit `feat(web): auth, apps, projects`.

### Task 7: Uploads

**Produces:** `ObjectStorage` interface + Supabase implementation; `signUpload`, `completeUpload`, `listAssets`.

- [x] Tests (in-memory storage): same image twice → one row; 26 MB → 413; PNG declared but text bytes → 400 + removed; sha mismatch → 400; foreign app → 404; real PNG gets width/height.
- [x] FAIL → implement → PASS; drop zone UI. Commit `feat(web): screenshot uploads`.

### Task 8: Credits badge, jobs, health, dev noop

**Produces:** `enqueueNoop(ctx, boss, { fail })`, `listJobs(ctx)`, `getBoss()`, `/api/credits`, `/api/jobs`, `/api/dev/noop` (404 unless `ENABLE_DEV_TOOLS=1`), `/api/health` (503 on failure).

- [x] Tests: balance 0 → error, no job; success → queued job, balance -1.
- [x] FAIL → implement → PASS; manual worker run. Commit `feat(web): credits badge, jobs panel, health route`.

### Task 9: CI and deploy docs

- [x] GitHub Actions: pnpm, Node 24, `supabase start`, migrate, typecheck, lint, test, web build.
- [x] README deploy section (Vercel, Supabase cloud, worker container).
- [x] Commit `ci: typecheck, lint, test with local supabase`.
