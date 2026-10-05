# Sub-project 11: Localization and AI Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remember one AI brief per app (audience, tone, keywords, app-type preset) and use it in every AI job. Add a translations table with inline edits, CSV/JSON import and export, and AI translation from any language with a per-app glossary. Make right-to-left languages read correctly and optionally mirror the layout. Add AI feature chips for the Google Play feature graphic. Add a competitor reference board whose analysis sharpens the brief.

**Architecture:** Pure logic lives in `packages/document`:
- `brief.ts` and `presets.ts`;
- `hash.ts` (moved from the renderer);
- `translations.ts` (rows, cell states, the single manual writer);
- `translationFiles.ts` (CSV/JSON plans);
- `chips.ts`;
- additions to `ai.ts`, covering the competitor schemas and `withFeatureGraphic`.

Mirroring and script leading are derived in the renderer's projection (`osg/i18n/project.ts`), so the canvas, previews, exports and video agree without storing anything per element. Every table edit is one editor command (`setTranslations`). AI jobs that rewrite the saved document from inside the editor go through one `DocJobProvider`: save, lock, follow the job, adopt the server document. Two new paid job types, `ai_chips` and `ai_reference`, follow the existing reserve, settle and refund path, with prices only in `packages/db/src/pricing.ts`.

**Tech Stack:** TypeScript, Next.js 16 (apps/web, non-standard: read `apps/web/node_modules/next/dist/docs/` before touching Next APIs), React 19, Zustand + Immer, Drizzle + Postgres (Supabase project from `.env`), pg-boss, Anthropic SDK structured outputs, Playwright worker with golden PNGs, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-sp11-localization-ai-copy-design.md` (feature research and reference code: `docs/roadmap/sp11-localization-ai-copy.md`)

## Global Constraints

- No document `schemaVersion` bump. Every new document field is optional, and the element type enum gains `chips`. Documents saved before SP11 must pass `migrate` unchanged (pinned in Task 8, `sp11-schema.test.ts`).
- Every editor change is exactly one `apply(command)`, so it is one undo step. A command that changes nothing returns the same document.
- **Billing**: Razorpay credit packs only, never Stripe. Prices are defined only in `packages/db/src/pricing.ts`:
  - `ai_chips` costs 1;
  - `ai_reference` costs 1 per uncached image, capped at `MAX_REFERENCES_PER_APP` (10);
  - `ai_translate` (2 per language) and `ai_design` (10, chips included) are unchanged.
- SP13 (public API, CLI, MCP) and SP14 (store upload, Drive/GitHub sync) are dropped. Add nothing for them.
- No URL fetching and no scraping. Competitor images arrive only as uploads, and no endpoint takes a URL.
- **Licences**:
  - storeshots is AGPL-3.0: ideas only, copy no code, prompt text or data.
  - appshots: copy nothing.
  - MIT ports get a `NOTICES.md` row. This sub-project ports the CSV parser and quoting from open-screenshot-generator. It also reuses the SP10 app-store-screenshots headline banks, which are already attributed.
  - Preset copy and all prompt text are written fresh.
- **Database**:
  - Tests that touch it use `DATABASE_URL` from the repo-root `.env` (the Supabase project's session pooler URL).
  - The migration workflow is `pnpm --filter @chitrapx/db generate`, then edit the generated SQL where a step says so, then `pnpm db:migrate`.
  - This sub-project adds exactly two migrations: `0010_*` (Task 1) and `0011_*` (Task 15).
- AI models come from `apps/worker/src/ai/model.ts` and are never hard-coded elsewhere:
  - `MODELS.fast` is for vision (competitor images).
  - `MODELS.writer` with `effort: "low"` is for chips and the competitor summary.
  - Tests use the scripted `fakeModel` in `apps/worker/test/ai.test.ts`. No test calls Anthropic.
- RTL locales are the `LOCALES` entries with `rtl: true` in `packages/renderer/src/osg/i18n/locales.ts`: `ar-SA`, `he`, `fa`, `ur`. Fonts for them come from the SP10 catalogue through `fontLanguageMatcher.ts` and are loaded from Google Fonts. Nothing new is self-hosted.
- Known pre-existing typecheck error: `apps/web/src/server/billing.ts:61` (TS2339, also on main). The gate is "no new errors".
- **E2E runs** need the Supabase project from `.env`, MinIO and the web dev server at `WEB_ORIGIN`. Start the server in the background, record its PID, and stop it with `kill <pid>`. Never use `pkill`.
- **Dev-server commands.** Every browser check and e2e run in this plan uses exactly these commands, from the repo root:

  ```bash
  pnpm storage:up && pnpm storage:setup
  cd apps/web && (nohup ./node_modules/.bin/next dev > /tmp/chitrapx-web.log 2>&1 & echo $! > /tmp/chitrapx-web.pid); cd ../..
  for i in $(seq 1 60); do curl -sf http://localhost:3000/api/health > /dev/null && break; sleep 2; done
  # ... the browser check, or: pnpm --filter @chitrapx/worker test:e2e
  kill "$(cat /tmp/chitrapx-web.pid)"
  ```

## Review Focus

1. **A translation a person wrote is never overwritten without the opt-in.** This applies to AI translation from the base or from another language, and to chip lists as well as text. An override without `origin` counts as manual. With `sourceLocale`, the "source changed while translating" check compares against that language's text, not the base. Pinned in Task 4 (`applyTranslations`), Task 7 (worker run from `fr-FR`) and Task 10 (chips).
2. **The CSV round trip.**
   - Quotes, commas, line breaks inside cells, a UTF-8 BOM and CRLF must survive export, a spreadsheet and import.
   - An empty cell never clears a translation.
   - An unknown id is reported and the other rows still import.
   - Applying the plan writes exactly the changed cells, as one undo step.
   - Pinned in Task 5 (plans) and Task 4 (`writeTranslations` no-op identity).
3. **Mirroring touches only what it should.**
   - The base language and every left-to-right language come back by reference.
   - A position the user detached for that language is not mirrored again.
   - A mirrored view is never written back into the base: `unprojectArtboards` refuses it, and the canvas hides its handles there.
   - Pinned in Task 8 (projection) and Task 9 (canvas, goldens: the base language of a mirrored project renders pixel-identical).
4. **Competitor images stay out of everything else.**
   - A `reference` asset must never appear in `listAssets`, so not in the editor, the upload grids or the AI design inputs. It must not appear in `assetUrlMap` either, so a document pointing at one fails export as `asset_missing`, and it must never reach a bundle.
   - The same file cannot be a reference and an ordinary upload of one app.
   - Deleting the image deletes its analysis.
   - Pinned in Task 15.
5. **Nobody pays for work that did not happen, or twice.**
   - `ai_reference` reserves at most the uncached images (cap 10), analyses only images it was paid for, and settles the number analysed. A re-run with everything cached is free and rate-limited.
   - `ai_chips` charges once, and `ai_design` charges nothing extra for its chips and feature graphic.
   - A translation language under 80% coverage is not charged.
   - Pinned in Tasks 7, 13, 14 and 16.

## File Structure

| File | Responsibility |
|---|---|
| `packages/document/src/brief.ts` (create) | brief schema, `briefText`, glossary schema |
| `packages/document/src/presets.ts` (create) | nine app-type presets, `applyPreset` |
| `packages/document/src/hash.ts` (create) | `hash32` (moved from the renderer) |
| `packages/document/src/translations.ts` (create) | rows, cell states, progress, `writeTranslations`, `lengthWarning`, `textsIn` |
| `packages/document/src/translationFiles.ts` (create) | CSV/JSON export and import plans |
| `packages/document/src/chips.ts` (create) | chip limits, normalisers, ids, `applyChips`, `remapChipOverride` |
| `packages/document/src/{artboard,doc,ai,retarget,catalog,index}.ts` (modify) | `ChipsElementProps`, `mirrorRtl`, chips in texts and translations, `withFeatureGraphic`, competitor schemas, `MAX_REFERENCES_PER_APP` |
| `packages/db/src/{schema,pricing,credits,assetCheck}.ts` (modify) | `apps.brief`, `apps.glossary`, `reference` kind, `reference_insights`, prices, expiries |
| `packages/db/migrations/0010_*.sql`, `0011_*.sql` (generated) | the two migrations |
| `packages/renderer/src/osg/i18n/{project,localization,hash}.ts` (modify) | mirroring, script leading, chips projection |
| `packages/renderer/src/osg/elements/ChipsElement.tsx` (create), `osg/StaticArtboard.tsx`, `fonts.tsx`, `index.ts` (modify) | chips rendering and faces |
| `packages/assets/templates/fg-{food-delivery,habit-tracker,music-stream,travel-explore}.json`, `packages/assets/catalog.json` (modify, regenerate) | chips in four feature graphics |
| `apps/worker/src/ai/{prompts,jobs}.ts`, `src/handlers.ts`, `src/bundle.ts` (modify) | `appBrief`, presets, competitor notes, `runAiChips`, `runAiReference`, feature graphic in design |
| `apps/web/src/server/{ai,apps,uploads,projects,jobs}.ts` (modify) | brief saving, translate options, chips and reference starters, reference uploads and isolation |
| `apps/web/src/app/api/projects/[projectId]/chips/route.ts`, `api/apps/[appId]/reference/route.ts`, `api/apps/[appId]/reference/[assetId]/route.ts` (create) | new routes |
| `apps/web/src/lib/followJob.ts` (create), `lib/uploadAsset.ts` (modify) | job polling; reference uploads |
| `apps/web/src/editor/{docJobs.tsx,translationsModel.ts}` (create), `editor/{commands.ts,Editor.tsx}` (modify) | doc-rewriting jobs; table model; `setTranslations`, `setMirrorRtl`, `setChips` |
| `apps/web/src/editor/ui/{TranslationsTable,ChipsEditor}.tsx` (create), `ui/{Toolbar,Canvas,Inspector,LeftPanel}.tsx` (modify) | editor UI |
| `apps/web/src/components/{ReferenceBoard.tsx,referenceModel.ts}` (create), `components/{AiDesignCard,ProjectAi}.tsx`, `jobText.ts` (modify) | dashboard UI |
| `apps/web/src/app/dashboard/apps/[appId]/page.tsx`, `dashboard/projects/[projectId]/page.tsx`, `editor/[projectId]/page.tsx` (modify) | wiring |

---

### Task 1: App brief and glossary: schema, migration, validation

**Files:**
- Create: `packages/document/src/brief.ts`
- Modify: `packages/document/src/index.ts`, `packages/db/src/schema.ts` (`apps`), `apps/web/src/server/apps.ts`
- Generate: `packages/db/migrations/0010_*.sql`
- Test: `packages/document/test/brief.test.ts` (create), `apps/web/test/apps.test.ts` (append)

**Interfaces:**
- Produces (from `@chitrapx/document`):
  - `BRIEF_MAX = 2000`, `BRIEF_TOO_LONG`, `BRIEF_TONES`, `type BriefTone`
  - `uniqueTerms(list)`
  - `briefFields` (`text`, `audience`, `tone`, `keywords`), `briefSchema` (strict, every field optional)
  - `type AppBriefFields = { text?; audience?; tone?: BriefTone | ""; keywords?: string[]; preset?; competitor? }`
  - `briefText(brief): string`
  - `GLOSSARY_MAX = 50`, `glossarySchema`
- DB: `schema.apps.brief` (`jsonb` typed `AppBriefFields`, default `{}`), `schema.apps.glossary` (`text[]`, default `{}`)
- `updateApp(ctx, appId, { brief?, glossary? })`: the brief is merged field by field and the glossary is replaced.

- [ ] **Step 1: Failing tests**

`packages/document/test/brief.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { briefSchema, briefText, glossarySchema } from "../src/index.ts";

describe("app brief", () => {
  it("serialises free text and the structured fields, leaving empty ones out", () => {
    expect(briefText({ text: "  For home baristas  ", audience: "Coffee nerds", tone: "calm", keywords: ["pour over", "grinder"] }))
      .toBe("For home baristas\nAudience: Coffee nerds\nTone: calm\nKeywords: pour over, grinder");
    expect(briefText({ audience: " ", tone: "", keywords: [] })).toBe("");
    expect(briefText(undefined)).toBe("");
  });

  it("rejects a brief over 2000 characters with a message, never cutting it", () => {
    const r = briefSchema.safeParse({ text: "x".repeat(2001) });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe("Keep the brief under 2000 characters");
    expect(briefSchema.parse({ text: ` ${"x".repeat(2000)} ` }).text).toHaveLength(2000);
  });

  it("keeps the first spelling of repeated keywords, at most 10, and refuses unknown fields and tones", () => {
    expect(briefSchema.parse({ keywords: ["Meal plan", "meal plan", " groceries "] }).keywords).toEqual(["Meal plan", "groceries"]);
    expect(briefSchema.safeParse({ keywords: Array.from({ length: 11 }, (_, i) => `k${i}`) }).success).toBe(false);
    expect(briefSchema.safeParse({ tone: "shouty" }).success).toBe(false);
    expect(briefSchema.safeParse({ colour: "red" }).success).toBe(false);
    expect(briefSchema.parse({ tone: "" }).tone).toBe("");
  });

  it("glossary terms are trimmed and deduplicated, at most 50 of 60 characters", () => {
    expect(glossarySchema.parse([" Bloom ", "bloom", "Pour-over Pro"])).toEqual(["Bloom", "Pour-over Pro"]);
    expect(glossarySchema.safeParse(Array.from({ length: 51 }, (_, i) => `t${i}`)).success).toBe(false);
    expect(glossarySchema.safeParse(["x".repeat(61)]).success).toBe(false);
    expect(glossarySchema.safeParse([" "]).success).toBe(false);
  });
});
```

In `apps/web/test/apps.test.ts`, change the apps import to `import { createApp, deleteApp, getApp, updateApp } from "@/server/apps.ts";` and append:

```ts
describe("app brief and glossary (SP11)", () => {
  it("merges the brief field by field and keeps fields that were not sent", async () => {
    const ctx = await ctxFor("pro");
    const app = await createApp(ctx, { name: "B" });
    expect(app).toMatchObject({ brief: {}, glossary: [] });
    await updateApp(ctx, app.id, { brief: { text: "  Busy parents  ", tone: "calm" } });
    const next = await updateApp(ctx, app.id, { brief: { keywords: ["Meal plan", "meal plan", "groceries"] } });
    expect(next.brief).toEqual({ text: "Busy parents", tone: "calm", keywords: ["Meal plan", "groceries"] });
  });

  it("rejects a brief over 2000 characters with a message and stores nothing", async () => {
    const ctx = await ctxFor("pro");
    const app = await createApp(ctx, { name: "L" });
    await expect(updateApp(ctx, app.id, { brief: { text: "x".repeat(2001) } }))
      .rejects.toMatchObject({ issues: [expect.objectContaining({ message: "Keep the brief under 2000 characters" })] });
    expect((await getApp(ctx, app.id)).brief).toEqual({});
  });

  it("replaces the glossary and validates its terms", async () => {
    const ctx = await ctxFor("pro");
    const app = await createApp(ctx, { name: "G" });
    expect((await updateApp(ctx, app.id, { glossary: ["Bloom", "bloom", "Pour-over Pro"] })).glossary).toEqual(["Bloom", "Pour-over Pro"]);
    expect((await updateApp(ctx, app.id, { glossary: [] })).glossary).toEqual([]);
    expect(await status(updateApp(ctx, app.id, { glossary: ["x".repeat(61)] }))).toBe(400);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @chitrapx/document exec vitest run test/brief.test.ts`
Expected: FAIL. `briefSchema` is not exported.

- [ ] **Step 3: Implement**

`packages/document/src/brief.ts`:

```ts
import { z } from "zod";

/** SP11: one brief per app. Free text plus optional structured fields, all serialised into the prompts by briefText. */
export const BRIEF_MAX = 2000;
export const BRIEF_TOO_LONG = `Keep the brief under ${BRIEF_MAX} characters`;
export const BRIEF_TONES = ["friendly", "professional", "playful", "bold", "calm", "premium"] as const;
export type BriefTone = (typeof BRIEF_TONES)[number];

/** Case-insensitive de-duplication that keeps the first spelling and the order. */
export function uniqueTerms(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((w) => {
    const k = w.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Field rules shared by the app PATCH and the AI design start. */
export const briefFields = {
  text: z.string().trim().max(BRIEF_MAX, BRIEF_TOO_LONG),
  audience: z.string().trim().max(200, "Keep the audience under 200 characters"),
  /** "" clears the tone. */
  tone: z.enum(BRIEF_TONES).or(z.literal("")),
  keywords: z.array(z.string().trim().min(1).max(40, "Keywords can be up to 40 characters"))
    .max(10, "Up to 10 keywords").transform(uniqueTerms),
};

export const briefSchema = z.object({
  text: briefFields.text.optional(),
  audience: briefFields.audience.optional(),
  tone: briefFields.tone.optional(),
  keywords: briefFields.keywords.optional(),
}).strict();

/** What `apps.brief` holds. Every field is optional; a new app has `{}`. */
export type AppBriefFields = {
  text?: string;
  audience?: string;
  tone?: BriefTone | "";
  keywords?: string[];
  /** A preset key, or "" for none. */
  preset?: string;
  /** The editable summary of the analysed competitor images. */
  competitor?: string;
};

/** The brief as every prompt reads it: free text, then one line per structured field. Empty fields are left out. */
export function briefText(b: AppBriefFields | null | undefined): string {
  if (!b) return "";
  const lines = [b.text?.trim() ?? ""];
  if (b.audience?.trim()) lines.push(`Audience: ${b.audience.trim()}`);
  if (b.tone) lines.push(`Tone: ${b.tone}`);
  if (b.keywords?.length) lines.push(`Keywords: ${b.keywords.join(", ")}`);
  return lines.filter(Boolean).join("\n");
}

export const GLOSSARY_MAX = 50;
/** Terms AI translation keeps exactly as written. The worker always adds the app name. */
export const glossarySchema = z.array(z.string().trim().min(1).max(60, "Glossary terms can be up to 60 characters"))
  .max(GLOSSARY_MAX, `Up to ${GLOSSARY_MAX} glossary terms`).transform(uniqueTerms);
```

Append to `packages/document/src/index.ts`:

```ts
export * from "./brief.ts";
```

In `packages/db/src/schema.ts`, change line 2 to `import type { AppBriefFields, BrandToken } from "@chitrapx/document";` and, in `apps`, after the `brand` column, add:

```ts
  /** SP11: one brief per app, reused by AI design, copy variants and chips. */
  brief: jsonb("brief").$type<AppBriefFields>().notNull().default({}),
  /** SP11: terms AI translation keeps exactly as written (the app name is always kept too). */
  glossary: text("glossary").array().notNull().default(sql`'{}'::text[]`),
```

In `apps/web/src/server/apps.ts`, change the document import to `import { BRAND_TOKENS, briefSchema, FONT_FAMILY_UNSAFE, glossarySchema } from "@chitrapx/document";` and replace `appFields`, `createInput` and `updateApp` with:

```ts
const appFields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000),
  platformHint: z.enum(["ios", "android", "both"]),
  brand: brandSchema,
  brief: briefSchema,
  glossary: glossarySchema,
};
const createInput = z.object({
  ...appFields,
  description: appFields.description.default(""),
  platformHint: appFields.platformHint.default("both"),
  brand: brandSchema.default({}),
  brief: briefSchema.default({}),
  glossary: glossarySchema.default([]),
});
```

```ts
export async function updateApp(ctx: Ctx, appId: string, raw: unknown): Promise<App> {
  const current = await getApp(ctx, appId);
  const input = updateInput.parse(raw);
  if (input.brand?.logoAssetId) {
    const [asset] = await db.select({ id: schema.assets.id }).from(schema.assets).where(and(
      eq(schema.assets.id, input.brand.logoAssetId), eq(schema.assets.workspaceId, ctx.workspaceId),
    ));
    if (!asset) throw badRequest("unknown_logo_asset");
  }
  const [app] = await db.update(schema.apps)
    .set({
      ...input,
      ...(input.brand && { brand: { ...current.brand, ...input.brand } }),
      // Like the brand, the brief is merged: a form that sends one field never clears the others.
      ...(input.brief && { brief: { ...current.brief, ...input.brief } }),
    })
    .where(own(ctx, appId)).returning();
  if (!app) throw notFound();
  return app;
}
```

- [ ] **Step 4: Generate and apply the migration**

Run: `pnpm --filter @chitrapx/db generate`
Expected: a new `packages/db/migrations/0010_<name>.sql` containing exactly:

```sql
ALTER TABLE "apps" ADD COLUMN "brief" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "glossary" text[] DEFAULT '{}'::text[] NOT NULL;
```

plus `meta/0010_snapshot.json` and a new `_journal.json` entry.

Run: `pnpm db:migrate`
Expected: exits 0.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @chitrapx/document exec vitest run test/brief.test.ts && pnpm --filter @chitrapx/web exec vitest run test/apps.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck`
Expected: the only error is `billing.ts:61`.

```bash
git add packages/document packages/db apps/web/src/server/apps.ts apps/web/test/apps.test.ts
git commit -m "feat(apps): one brief and glossary per app, validated and merged on save"
```

---

### Task 2: The brief in AI design, copy variants and the AI card

**Files:**
- Modify: `apps/web/src/server/ai.ts` (`designInput`, `startAiDesign`), `apps/worker/src/ai/prompts.ts` (`AppRow`, `appBrief`, `variantsPrompt`), `apps/worker/src/ai/jobs.ts` (`designInput`, `projectDoc`, `runAiDesign`, `runAiTranslate`, `runAiCopy`)
- Modify: `apps/web/src/components/AiDesignCard.tsx`, `apps/web/src/components/ProjectAi.tsx`, `apps/web/src/app/dashboard/apps/[appId]/page.tsx`, `apps/web/src/app/dashboard/projects/[projectId]/page.tsx`
- Test: `apps/web/test/ai.test.ts` (append), `apps/worker/test/prompts.test.ts` (create), `apps/worker/test/ai.test.ts` (append)

**Interfaces:**
- Consumes: `briefFields`, `briefText`, `AppBriefFields` (Task 1).
- Produces:
  - `startAiDesign(ctx, boss, appId, { brief?, audience?, tone?, keywords? })` saves the fields sent into `apps.brief` and queues `{ appId, brief? }`, where `brief` is the serialised text.
  - Worker `type AppRow = { name; description; platformHint; brand; brief: AppBriefFields }` and `appBrief(app: AppRow, submitted?: { brief?: string }): AppBrief`.
  - `variantsPrompt(app: Pick<AppBrief, "name" | "brief">, texts)`.
  - `projectDoc(job)` now returns `{ doc, app }`, where `app` is the full apps row.
  - `AiDesignCard` props `{ appId, screenshotCount, brief: AppBriefFields }`.
  - `ProjectAi` props `{ projectId, appId, brief: string, codes }`.

- [ ] **Step 1: Failing tests**

Append to `apps/web/test/ai.test.ts`. Change the apps import to `import { createApp, getApp } from "@/server/apps.ts";`.

```ts
describe("AI brief (SP11)", () => {
  const inputOf = async (jobId: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)))[0]!.input;

  it("design remembers the brief on the app and sends it, serialised, to the job", async () => {
    const s = await setup(20);
    const { jobId } = await startAiDesign(s.ctx, boss, s.app.id, { brief: "For home baristas", audience: "Coffee nerds", tone: "calm", keywords: ["pour over"] });
    expect(await inputOf(jobId)).toEqual({ appId: s.app.id, brief: "For home baristas\nAudience: Coffee nerds\nTone: calm\nKeywords: pour over" });
    expect((await getApp(s.ctx, s.app.id)).brief).toEqual({ text: "For home baristas", audience: "Coffee nerds", tone: "calm", keywords: ["pour over"] });
  });

  it("a body with only the free-text brief works as before and keeps the saved fields", async () => {
    const s = await setup(30);
    await startAiDesign(s.ctx, boss, s.app.id, { brief: "first", tone: "bold" });
    const { jobId } = await startAiDesign(s.ctx, boss, s.app.id, { brief: "second" });
    expect(await inputOf(jobId)).toEqual({ appId: s.app.id, brief: "second\nTone: bold" });
  });

  it("a brief over 2000 characters is refused with a message, and nothing is created or charged", async () => {
    const s = await setup(20);
    await expect(startAiDesign(s.ctx, boss, s.app.id, { brief: "x".repeat(2001) }))
      .rejects.toMatchObject({ issues: [expect.objectContaining({ message: "Keep the brief under 2000 characters" })] });
    expect(await balance(db, s.ctx.workspaceId)).toBe(20);
    expect(await listProjects(s.ctx, s.app.id)).toEqual([]);
  });
});
```

`apps/worker/test/prompts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { appBrief, copyPrompt, pickPrompt, variantsPrompt, type AppBrief } from "../src/ai/prompts.ts";

const app: AppBrief = { name: "Bloom", description: "Coffee recipes", platform: "ios", brief: "Busy parents\nKeywords: pour over, grinder", brand: {} };

describe("prompt builders (SP11)", () => {
  it("copy variants read the app's brief", () => {
    expect(variantsPrompt({ name: "Bloom", brief: "Audience: home baristas" }, [{ id: "h", text: "Brew" }])).toContain("Brief: Audience: home baristas");
    expect(variantsPrompt({ name: "Bloom", brief: "" }, [])).toContain("Brief: (none)");
  });

  it("keywords reach the pick and copy prompts as a list", () => {
    expect(pickPrompt(app, [])).toContain("Keywords: pour over, grinder");
    expect(copyPrompt(app, [], [], [], [])).toContain("Keywords: pour over, grinder");
  });

  it("appBrief serialises the stored brief unless a submitted one is given", () => {
    const row = { name: "Bloom", description: "d", platformHint: "both", brand: {}, brief: { text: "Saved", tone: "calm" as const } };
    expect(appBrief(row).brief).toBe("Saved\nTone: calm");
    expect(appBrief(row, { brief: "Submitted" }).brief).toBe("Submitted");
  });
});
```

Append inside the `describe("ai_copy", ...)` block of `apps/worker/test/ai.test.ts`:

```ts
  it("copy variants use the app's stored brief", async () => {
    const s = await setup(1);
    await db.update(schema.apps).set({ brief: { text: "For home baristas", keywords: ["pour over"] } }).where(eq(schema.apps.id, s.app.id));
    const [t] = await db.select().from(schema.templates).where(eq(schema.templates.slug, "amoura-dating"));
    await db.update(schema.projects).set({ doc: migrate(t!.doc) }).where(eq(schema.projects.id, s.project.id));
    const { model, calls } = fakeModel(() => ({ variants: ["confident", "warm", "punchy"].map((tone) => ({ tone, texts: [{ id: "amoura-b1-headline-1-1", text: tone }] })) }));
    const jobId = await queue(s.ws, s.project.id, "ai_copy", {}, 3);
    await runJob(jobId, (input, job) => runAiCopy(input, job, deps(model)));
    expect((await jobRow(jobId)).status).toBe("done");
    expect((calls[0]!.content[0] as { text: string }).text).toContain("Brief: For home baristas\nKeywords: pour over");
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @chitrapx/worker exec vitest run test/prompts.test.ts`
Expected: FAIL. `appBrief` is not exported.

- [ ] **Step 3: Server**

In `apps/web/src/server/ai.ts`, change the imports to:

```ts
import { allTexts, briefFields, briefText, LOCALE_CODE, type AppBriefFields, type ChitrapxDoc } from "@chitrapx/document";
import { getApp, updateApp } from "./apps.ts";
```

and replace `designInput` and `startAiDesign` with:

```ts
const designInput = z.object({
  brief: briefFields.text.optional(),
  audience: briefFields.audience.optional(),
  tone: briefFields.tone.optional(),
  keywords: briefFields.keywords.optional(),
});
```

```ts
/** Creates the project the design lands in, then queues the job. If queueing fails it is removed; if the job fails, the worker removes it. */
export async function startAiDesign(ctx: Ctx, boss: PgBoss, appId: string, raw: unknown) {
  const app = await getApp(ctx, appId);
  const input = designInput.parse(raw ?? {});
  const [{ n }] = (await db.select({ n: count() }).from(schema.assets).where(and(
    eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.appId, app.id), eq(schema.assets.kind, "screenshot"),
  ))) as [{ n: number }];
  if (!n) throw badRequest("no_screenshots");
  // Remembered on the app for the next design and for copy variants; fields not sent keep their saved values.
  const patch: AppBriefFields = {};
  if (input.brief !== undefined) patch.text = input.brief;
  if (input.audience !== undefined) patch.audience = input.audience;
  if (input.tone !== undefined) patch.tone = input.tone;
  if (input.keywords !== undefined) patch.keywords = input.keywords;
  const saved = Object.keys(patch).length ? (await updateApp(ctx, app.id, { brief: patch })).brief : app.brief;
  const brief = briefText(saved);
  const project = await createProject(ctx, app.id, { name: "AI design", kind: "screenshots" });
  try {
    const { jobId } = await enqueue(ctx, boss, project.id, "ai_design", { appId: app.id, ...(brief && { brief }) });
    return { projectId: project.id, jobId };
  } catch (err) {
    await deleteProject(ctx, project.id);
    throw err;
  }
}
```

- [ ] **Step 4: Worker**

In `apps/worker/src/ai/prompts.ts`, change the import to `import { briefText, type AppBriefFields, type CatalogEntry, type ScreenInsight, type SlotText, type TextSlot } from "@chitrapx/document";` and, after the `AppBrief` type, add:

```ts
/** The parts of an apps row every prompt reads. */
export type AppRow = { name: string; description: string; platformHint: string; brand: AppBrief["brand"]; brief: AppBriefFields };

/** What every prompt knows about the app. `submitted` is what an AI design was started with; otherwise the saved brief is used. */
export function appBrief(app: AppRow, submitted: { brief?: string } = {}): AppBrief {
  return { name: app.name, description: app.description, platform: app.platformHint, brief: submitted.brief ?? briefText(app.brief), brand: app.brand };
}
```

Replace `variantsPrompt` with:

```ts
export const variantsPrompt = (app: Pick<AppBrief, "name" | "brief">, texts: SlotText[]) =>
  `App: ${app.name}\nBrief: ${app.brief || "(none)"}\nCurrent copy (id and text):\n${JSON.stringify(texts)}`;
```

In `apps/worker/src/ai/jobs.ts`:
- Add `appBrief` to the `./prompts.ts` import and drop `type AppBrief` from it.
- Change `designInput` to `z.object({ appId: z.uuid(), brief: z.string().max(4000).optional() })`. The serialised brief carries the structured lines on top of the 2000-character text.
- Replace `projectDoc`:

```ts
/** The job's project document and its app's row (the name is a glossary term in every language; the brief steers copy). */
async function projectDoc(job: JobContext): Promise<{ doc: ChitrapxDoc; app: typeof schema.apps.$inferSelect }> {
  if (!job.projectId) throw new FatalJobError("job_without_project");
  const [p] = await db.select({ doc: schema.projects.doc, app: schema.apps }).from(schema.projects)
    .innerJoin(schema.apps, eq(schema.apps.id, schema.projects.appId))
    .where(and(eq(schema.projects.id, job.projectId), eq(schema.projects.workspaceId, job.workspaceId)));
  if (!p) throw new FatalJobError("project_missing");
  return { doc: migrate(p.doc), app: p.app };
}
```

In `runAiDesign`, replace the `const brief: AppBrief = …` line with `const brief = appBrief(app, { brief: input.data.brief });`. In `runAiTranslate`, replace `const { doc, appName } = await projectDoc(job);` with `const { doc, app } = await projectDoc(job);`, and `const glossary = [appName].filter(Boolean);` with `const glossary = [app.name].filter(Boolean);`. Replace `runAiCopy` with:

```ts
/** Three alternative copy sets; the editor applies one. Never changes the document itself. */
export async function runAiCopy(_raw: unknown, job: JobContext, deps: AiDeps) {
  const { doc, app } = await projectDoc(job);
  const texts = allTexts(doc).filter((t) => t.text.trim());
  if (!texts.length) throw new FatalJobError("nothing_to_rewrite");
  if (texts.reduce((n, t) => n + t.text.length, 0) > MAX_TEXT_CHARS) throw new FatalJobError("too_much_text");
  const { data, usage } = await deps.model.generate({
    model: MODELS.writer, system: VARIANTS_SYSTEM, schema: variantsSchema, effort: "medium",
    content: [{ type: "text", text: variantsPrompt(appBrief(app), texts) }],
  });
  const known = new Set(texts.map((t) => t.id));
  const variants = TONES.map((tone) => ({ tone, texts: (data.variants.find((v) => v.tone === tone)?.texts ?? []).filter((t) => known.has(t.id)) }))
    .filter((v) => v.texts.length);
  if (!variants.length) throw new FatalJobError("ai_no_variants");
  return { actual: PRICES.ai_copy, output: { variants, usage: sumUsage([usage]) } };
}
```

- [ ] **Step 5: AI card and project page**

`apps/web/src/components/AiDesignCard.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BRIEF_MAX, BRIEF_TONES, type AppBriefFields } from "@chitrapx/document";
import { api } from "@/server/api.ts";

const keywordList = (s: string) => s.split(",").map((k) => k.trim()).filter(Boolean);

/** The brief is saved on the app when a design starts, so it is prefilled next time and reused by copy variants and chips. */
export function AiDesignCard({ appId, screenshotCount, brief: saved }: { appId: string; screenshotCount: number; brief: AppBriefFields }) {
  const router = useRouter();
  const [form, setForm] = useState({ text: saved.text ?? "", audience: saved.audience ?? "", tone: saved.tone ?? "", keywords: (saved.keywords ?? []).join(", ") });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const length = form.text.trim().length;

  async function start() {
    setBusy(true);
    setError("");
    try {
      const { projectId } = await api<{ projectId: string }>(`/api/apps/${appId}/ai-design`, "POST", {
        brief: form.text, audience: form.audience, tone: form.tone, keywords: keywordList(form.keywords),
      });
      router.push(`/dashboard/projects/${projectId}`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <section id="ai-brief" className="card space-y-3 border-indigo-200 bg-gradient-to-br from-indigo-50 to-white dark:border-indigo-900 dark:from-indigo-950 dark:to-neutral-900">
      <div>
        <h2 className="font-semibold">Design with AI</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Chitrapx studies your screenshots, picks a template, orders the screens for conversion and writes the copy. You can change everything afterwards.
        </p>
      </div>
      <label className="label" htmlFor="ai-brief-text">Anything the AI should know? (optional)</label>
      <textarea id="ai-brief-text" className="input min-h-16" placeholder="Audience, tone, the features that matter most" value={form.text}
        onChange={(e) => set({ text: e.target.value })} aria-describedby="ai-brief-count" />
      <p id="ai-brief-count" className={`text-xs ${length > BRIEF_MAX ? "text-red-600" : "text-neutral-500"}`}>{length} / {BRIEF_MAX}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="ai-audience">Audience</label>
          <input id="ai-audience" className="input" placeholder="Who the app is for" value={form.audience} onChange={(e) => set({ audience: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="ai-tone">Tone</label>
          <select id="ai-tone" className="input" value={form.tone} onChange={(e) => set({ tone: e.target.value as typeof form.tone })}>
            <option value="">Any</option>
            {BRIEF_TONES.map((t) => <option key={t} value={t}>{t[0]!.toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ai-keywords">Keywords</label>
          <input id="ai-keywords" className="input" placeholder="comma, separated" value={form.keywords} onChange={(e) => set({ keywords: e.target.value })} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn" onClick={start} disabled={busy || screenshotCount === 0}>{busy ? "Starting" : "Design with AI (10 credits)"}</button>
        {screenshotCount === 0 && <span className="text-sm text-neutral-500">Upload screenshots below first.</span>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  );
}
```

In `apps/web/src/app/dashboard/apps/[appId]/page.tsx`, render `<AiDesignCard appId={app.id} screenshotCount={assets.filter((a) => a.kind === "screenshot").length} brief={app.brief} />`.

In `apps/web/src/components/ProjectAi.tsx`, add `import Link from "next/link";` and change the signature to `export function ProjectAi({ projectId, appId, brief, codes }: { projectId: string; appId: string; brief: string; codes: string[] })`. As the first child of the `<section>`, add:

```tsx
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        AI brief: {brief ? brief.split("\n")[0] : "none yet"}{" "}
        <Link href={`/dashboard/apps/${appId}#ai-brief`} className="text-indigo-600 hover:underline">Edit</Link>
      </p>
```

In `apps/web/src/app/dashboard/projects/[projectId]/page.tsx`:
- Add `import { briefText } from "@chitrapx/document";` and `import { getApp } from "@/server/apps.ts";`.
- Load the app with the rest: `const [assetUrls, extras, app] = await Promise.all([assetUrlMap(ctx, appStorage(), project.doc), renderExtras(ctx, appStorage(), { doc: project.doc, appId: project.appId }), getApp(ctx, project.appId)]);`.
- Render `<ProjectAi projectId={project.id} appId={project.appId} brief={briefText(app.brief)} codes={[project.doc.localization.baseLocale, ...project.doc.localization.locales.map((l) => l.code)]} />`.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @chitrapx/worker exec vitest run test/prompts.test.ts test/ai.test.ts && pnpm --filter @chitrapx/web exec vitest run test/ai.test.ts`
Expected: PASS. The existing `startAiDesign(..., { brief: "cozy" })` test also passes.

- [ ] **Step 7: Browser check**

Start the web dev server with the dev-server commands in Global Constraints.
- On an app page, type a brief, an audience, the tone "Calm" and two keywords, then click "Design with AI". Go back to the app: all four fields are prefilled.
- Paste 2100 characters: the counter turns red, and submitting shows "brief: Keep the brief under 2000 characters". Nothing is charged.
- The project page shows "AI brief: <first line> Edit", and Edit lands on the card.

Stop the server by PID.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: the only error is `billing.ts:61`.

```bash
git add apps/web apps/worker
git commit -m "feat(ai): the brief is remembered per app, has audience, tone and keywords, and steers copy variants"
```

---

### Task 3: Quick-start presets by app type

**Files:**
- Create: `packages/document/src/presets.ts`
- Modify: `packages/document/src/brief.ts` (`preset`), `packages/document/src/index.ts`, `apps/worker/src/ai/prompts.ts` (`AppBrief.preset`, `appBrief`, `verticalLines`, `pickPrompt`, `copyPrompt`), `apps/worker/src/ai/jobs.ts` (`designInput`), `apps/web/src/server/ai.ts`, `apps/web/src/components/AiDesignCard.tsx`
- Test: `packages/document/test/presets.test.ts` (create), `apps/worker/test/prompts.test.ts` (append), `apps/web/test/ai.test.ts` (append)

**Interfaces:**
- Produces:
  - `type Preset = { key; label; description; audience; tone: BriefTone; aiBrief; voice; palette: Record<BrandToken, string>; chips: readonly string[]; bankId? }`
  - `PRESETS` (9 entries), `type PresetKey`, `PRESET_KEYS`, `presetFor(key)`
  - `applyPreset(form, key, replaceText?)`
  - `briefSchema.preset` (a `PresetKey` or `""`); `AppBriefFields.preset?: PresetKey | ""`
  - `AppBrief.preset?: string`, `verticalLines(app)`, `appBrief(app, { brief?, preset? })`
- Job input of `ai_design` gains `preset?: PresetKey`.

- [ ] **Step 1: Failing tests**

`packages/document/test/presets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyPreset, BRAND_TOKENS, BRIEF_TONES, briefSchema, CATEGORY_BANKS, PRESET_KEYS, PRESETS, presetFor } from "../src/index.ts";

describe("presets", () => {
  it("nine presets with a valid tone, a full palette, a real bank and chips that fit a pill", () => {
    expect(PRESETS.map((p) => p.key)).toEqual(["saas", "game", "finance", "health", "education", "travel", "social", "ecommerce", "utilities"]);
    expect(new Set(PRESET_KEYS).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(BRIEF_TONES, p.key).toContain(p.tone);
      expect(Object.keys(p.palette).sort(), p.key).toEqual([...BRAND_TOKENS].sort());
      for (const c of Object.values(p.palette)) expect(c, p.key).toMatch(/^#[0-9A-F]{6}$/);
      if (p.bankId) expect(CATEGORY_BANKS.some((b) => b.id === p.bankId), p.key).toBe(true);
      expect(p.chips.length, p.key).toBeGreaterThanOrEqual(4);
      for (const c of p.chips) {
        expect(c.length, c).toBeLessThanOrEqual(16);
        expect(c.split(" ").length, c).toBeLessThanOrEqual(2);
      }
      expect(briefSchema.safeParse({ text: p.aiBrief, audience: p.audience, tone: p.tone, preset: p.key }).success, p.key).toBe(true);
    }
  });

  it("fills only empty fields; a written brief is replaced only when confirmed", () => {
    const finance = presetFor("finance")!;
    expect(applyPreset({ text: "", audience: "", tone: "" }, "finance")).toEqual({ text: finance.aiBrief, audience: finance.audience, tone: "calm", preset: "finance" });
    expect(applyPreset({ text: "Mine", audience: "Teens", tone: "bold" }, "finance")).toEqual({ text: "Mine", audience: "Teens", tone: "bold", preset: "finance" });
    expect(applyPreset({ text: "Mine", audience: "", tone: "" }, "finance", true).text).toBe(finance.aiBrief);
  });

  it("the brief takes a preset key or none, nothing else", () => {
    expect(briefSchema.parse({ preset: "game" }).preset).toBe("game");
    expect(briefSchema.parse({ preset: "" }).preset).toBe("");
    expect(briefSchema.safeParse({ preset: "crypto-casino" }).success).toBe(false);
  });
});
```

Append inside the `describe` of `apps/worker/test/prompts.test.ts`:

```ts
  it("a preset adds its vertical to the pick and copy prompts; two presets read differently; none changes nothing", () => {
    const plain = pickPrompt(app, []);
    const finance = pickPrompt({ ...app, preset: "finance" }, []);
    const game = pickPrompt({ ...app, preset: "game" }, []);
    expect(plain).not.toContain("Vertical:");
    expect(finance).toContain("Vertical: Finance / Fintech.");
    expect(finance).toContain('"Your money, finally clear."');
    expect(finance).not.toBe(game);
    expect(copyPrompt({ ...app, preset: "game" }, [], [], [], [])).toContain("Vertical: Game / Entertainment.");
    expect(copyPrompt(app, [], [], [], [])).not.toContain("Vertical:");
  });

  it("suggests the preset's colours only when the app has no brand colours", () => {
    expect(pickPrompt({ ...app, preset: "finance" }, [])).toContain("Suggested colours for this vertical: #0F766E");
    expect(pickPrompt({ ...app, preset: "finance", brand: { primaryColor: "#112233" } }, [])).not.toContain("Suggested colours");
  });
```

Add `import { ZodError } from "zod";` to `apps/web/test/ai.test.ts` and append inside `describe("AI brief (SP11)", ...)`:

```ts
  it("a preset is saved with the brief and passed to the job; an unknown one is refused", async () => {
    const s = await setup(20);
    const { jobId } = await startAiDesign(s.ctx, boss, s.app.id, { brief: "Budgets", preset: "finance" });
    expect(await inputOf(jobId)).toEqual({ appId: s.app.id, brief: "Budgets", preset: "finance" });
    expect((await getApp(s.ctx, s.app.id)).brief.preset).toBe("finance");
    await expect(startAiDesign(s.ctx, boss, s.app.id, { preset: "crypto-casino" })).rejects.toBeInstanceOf(ZodError);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @chitrapx/document exec vitest run test/presets.test.ts`
Expected: FAIL. `PRESETS` is not exported.

- [ ] **Step 3: Preset data**

`packages/document/src/presets.ts`:

```ts
// SP11 quick-start presets. Copy written for Chitrapx; each preset points at an SP10 headline bank
// (app-store-screenshots, MIT, see NOTICES.md) whose lines show the model the register, never the words.
import type { BrandToken } from "./brand.ts";
import type { BriefTone } from "./brief.ts";

export type Preset = {
  key: string;
  label: string;
  description: string;
  audience: string;
  tone: BriefTone;
  /** Seeds an empty brief. */
  aiBrief: string;
  /** How copy for this vertical should sound; goes into the pick and copy prompts. */
  voice: string;
  /** Suggested to the AI when the app has no brand colours; never written to the brand. */
  palette: Record<BrandToken, string>;
  /** Example feature chips, shown to the chips writer as style. */
  chips: readonly string[];
  bankId?: string;
};

export const PRESETS = [
  {
    key: "saas", label: "SaaS / Productivity", description: "Work tools, notes, tasks and team apps.",
    audience: "Professionals and small teams who want to get more done with less busywork", tone: "professional",
    aiBrief: "Focus on time saved and clarity. Lead with the single biggest outcome, then show how tasks, notes and reminders fit together. Keep claims concrete; no buzzwords.",
    voice: "Sound capable and calm: concrete time saved, no buzzwords.",
    palette: { primary: "#2563EB", secondary: "#0F172A", accent: "#22C55E", surface: "#F8FAFC", text: "#0F172A", muted: "#64748B" },
    chips: ["Smart lists", "Reminders", "Team sharing", "Offline mode", "Calendar sync"], bankId: "bank.productivity",
  },
  {
    key: "game", label: "Game / Entertainment", description: "Games, streaming and fun.",
    audience: "Players looking for a quick, satisfying session or a world to sink into", tone: "playful",
    aiBrief: "Sell the feeling of playing: the core loop, the moment of winning, the characters. Short, energetic lines. Mention modes and rewards the screenshots show; never invent rankings or awards.",
    voice: "Sound energetic and vivid: verbs, moments and rewards, short lines.",
    palette: { primary: "#7C3AED", secondary: "#111827", accent: "#F59E0B", surface: "#1E1B4B", text: "#FFFFFF", muted: "#C4B5FD" },
    chips: ["Daily quests", "Co-op play", "New levels", "Leaderboards", "No ads"],
  },
  {
    key: "finance", label: "Finance / Fintech", description: "Budgets, banking, payments and investing.",
    audience: "People who want to understand and control their money without spreadsheets", tone: "calm",
    aiBrief: "Lead with clarity and control. Show budgets, spending insights and security plainly. Trust matters more than excitement: no promises of returns, no hype.",
    voice: "Sound trustworthy and plain: clarity and control, no promises of returns.",
    palette: { primary: "#0F766E", secondary: "#0B1F33", accent: "#F5B700", surface: "#F2F7F6", text: "#0B1F33", muted: "#5B7083" },
    chips: ["Smart budgets", "Bill alerts", "Bank security", "Insights", "Shared wallets"], bankId: "bank.finance",
  },
  {
    key: "health", label: "Health / Wellness", description: "Sleep, fitness, mindfulness and habits.",
    audience: "People building calmer, healthier daily routines", tone: "calm",
    aiBrief: "Speak gently and specifically: sleep, movement, mindfulness, habits. Show progress without guilt. Avoid medical claims and before-and-after promises.",
    voice: "Sound warm and gentle: small daily wins, no medical claims.",
    palette: { primary: "#10B981", secondary: "#064E3B", accent: "#F472B6", surface: "#F0FDF7", text: "#064E3B", muted: "#6B8F80" },
    chips: ["Sleep tracking", "Guided breathing", "Daily streaks", "Gentle nudges", "Health sync"], bankId: "bank.health",
  },
  {
    key: "education", label: "Education", description: "Courses, languages and study tools.",
    audience: "Learners who have a few minutes a day and want real progress", tone: "friendly",
    aiBrief: "Show how little time it takes and what the learner can do afterwards. Lessons, practice and streaks. Encouraging, never childish unless the app is for kids.",
    voice: "Sound encouraging and clear: progress in minutes a day.",
    palette: { primary: "#F97316", secondary: "#1E3A8A", accent: "#FACC15", surface: "#FFF7ED", text: "#1E293B", muted: "#64748B" },
    chips: ["Short lessons", "Quizzes", "Daily streaks", "Offline study", "Progress stats"], bankId: "bank.learning",
  },
  {
    key: "travel", label: "Travel", description: "Trips, maps, bookings and guides.",
    audience: "Travellers planning trips and finding their way on the go", tone: "friendly",
    aiBrief: "Lead with the trip, not the app: places, plans, maps that work offline. Evoke the destination while staying practical about bookings and itineraries.",
    voice: "Sound inviting and practical: the destination first, then the plan.",
    palette: { primary: "#0EA5E9", secondary: "#0C4A6E", accent: "#F97316", surface: "#F0F9FF", text: "#0C4A6E", muted: "#5E7C91" },
    chips: ["Offline maps", "Trip planner", "Local picks", "Price alerts", "Shared plans"], bankId: "bank.travel",
  },
  {
    key: "social", label: "Social", description: "Chat, communities, events and dating.",
    audience: "People who want to stay close to friends and find their community", tone: "friendly",
    aiBrief: "Lead with people and moments, not features. Show chat, groups and events as ways to connect. Warm and inclusive; avoid follower-count bragging.",
    voice: "Sound warm and inclusive: people and moments, not metrics.",
    palette: { primary: "#EC4899", secondary: "#4C1D95", accent: "#22D3EE", surface: "#FDF2F8", text: "#2E1065", muted: "#8B6B9E" },
    chips: ["Group chats", "Events", "Stories", "Private circles", "Voice notes"], bankId: "bank.social",
  },
  {
    key: "ecommerce", label: "E-commerce", description: "Shops, marketplaces and delivery.",
    audience: "Shoppers who want to find the right thing fast and check out without friction", tone: "bold",
    aiBrief: "Lead with the products and the ease of buying: discovery, fast checkout, tracking, returns. Concrete offers only if the screenshots show them; no fake discounts.",
    voice: "Sound confident and direct: find it fast, buy it easily, no fake urgency.",
    palette: { primary: "#E11D48", secondary: "#111827", accent: "#FBBF24", surface: "#FFF1F2", text: "#111827", muted: "#6B7280" },
    chips: ["Fast checkout", "Order tracking", "Easy returns", "Wishlists", "Daily deals"],
  },
  {
    key: "utilities", label: "Utilities", description: "Tools, widgets, scanners and settings.",
    audience: "People who want one tool that does its job quickly and reliably", tone: "professional",
    aiBrief: "Lead with the job the tool does and how fast it does it. Show widgets, shortcuts and privacy. Plain, confident, no fluff.",
    voice: "Sound precise and quick: the job done in a tap, privacy plainly stated.",
    palette: { primary: "#475569", secondary: "#0F172A", accent: "#38BDF8", surface: "#F1F5F9", text: "#0F172A", muted: "#64748B" },
    chips: ["Home widgets", "One-tap actions", "Privacy first", "Dark mode", "No sign-up"], bankId: "bank.developer",
  },
] as const satisfies readonly Preset[];

export type PresetKey = (typeof PRESETS)[number]["key"];
export const PRESET_KEYS = PRESETS.map((p) => p.key) as [PresetKey, ...PresetKey[]];
export const presetFor = (key: string | undefined): Preset | undefined => PRESETS.find((p) => p.key === key);

/**
 * What picking a preset does to the brief form: empty fields take the preset's values, filled ones are kept.
 * A written brief is replaced only when `replaceText` is set (the user confirmed).
 */
export function applyPreset<T extends { text: string; audience: string; tone: string }>(form: T, key: PresetKey, replaceText = false): T & { preset: PresetKey } {
  const p = presetFor(key)!;
  return {
    ...form,
    text: !form.text.trim() || replaceText ? p.aiBrief : form.text,
    audience: form.audience.trim() ? form.audience : p.audience,
    tone: form.tone || p.tone,
    preset: key,
  };
}
```

In `packages/document/src/brief.ts`:
- Add `import { PRESET_KEYS, type PresetKey } from "./presets.ts";`. `presets.ts` imports only a type from `brief.ts`, so there is no runtime cycle.
- Add `preset: z.enum(PRESET_KEYS).or(z.literal("")).optional(),` to `briefSchema`.
- Change `AppBriefFields.preset` to `preset?: PresetKey | "";`.

Append `export * from "./presets.ts";` to `packages/document/src/index.ts`.

- [ ] **Step 4: Prompts and job input**

In `apps/worker/src/ai/prompts.ts`, add `CATEGORY_BANKS` and `presetFor` to the `@chitrapx/document` import and add `/** SP11: a preset key; the vertical steers voice and examples. */ preset?: string;` to `AppBrief`. Replace `appBrief`, and add `verticalLines` after it:

```ts
export function appBrief(app: AppRow, submitted: { brief?: string; preset?: string } = {}): AppBrief {
  return {
    name: app.name, description: app.description, platform: app.platformHint, brief: submitted.brief ?? briefText(app.brief), brand: app.brand,
    preset: submitted.preset ?? (app.brief.preset || undefined),
  };
}

/** The preset's vertical: one voice line and three bank headlines for register. Empty without a preset. */
export function verticalLines(app: Pick<AppBrief, "preset">): string {
  const p = presetFor(app.preset);
  if (!p) return "";
  const bank = CATEGORY_BANKS.find((b) => b.id === p.bankId);
  const examples = bank
    ? `\nExample headlines for this vertical (register only, never copy): ${bank.lines.slice(0, 3).map((l) => JSON.stringify(l.text.replace(/\n/g, " "))).join(", ")}`
    : "";
  return `\nVertical: ${p.label}. ${p.voice}${examples}`;
}
```

Replace `pickPrompt` and `copyPrompt`:

```ts
export function pickPrompt(app: AppBrief, insights: ScreenInsight[]): string {
  const colours = [app.brand.primaryColor, app.brand.secondaryColor].filter(Boolean).join(", ");
  const p = presetFor(app.preset);
  const suggested = !colours && p ? `\nSuggested colours for this vertical: ${Object.values(p.palette).join(", ")}` : "";
  return `App: ${app.name} (${app.platform})
Description: ${app.description || "(none)"}
Brief from the team: ${app.brief || "(none)"}${verticalLines(app)}
Brand colours: ${colours || "(none)"}${suggested}

Screenshots, by index:
${insights.map((s, i) => `${i}. ${s.summary} Feature: ${s.feature}. Mood: ${s.mood}.`).join("\n")}`;
}
```

```ts
const slotLine = (s: TextSlot) => `  - id "${s.id}", role "${s.role}", max ${s.maxChars} chars, sample: ${JSON.stringify(s.text)}`;

/** `perBoard[i]` lists positions in `order` shown on board i (none, one, or several devices). */
export function copyPrompt(app: AppBrief, insights: ScreenInsight[], order: number[], perBoard: number[][], slots: TextSlot[][]): string {
  return `App: ${app.name}
Description: ${app.description || "(none)"}
Brief: ${app.brief || "(none)"}${verticalLines(app)}

Boards in order, with the screenshots each one shows.
${slots.map((board, i) => {
    const shots = (perBoard[i] ?? []).map((k) => insights[order[k] ?? -1]).filter((s): s is ScreenInsight => !!s);
    return `Board ${i}${shots.length ? ` shows: ${shots.map((s) => `${s.summary} (feature: ${s.feature})`).join("; ")}` : " shows no screenshot"}
${board.map(slotLine).join("\n")}`;
  }).join("\n\n")}`;
}
```

In `apps/worker/src/ai/jobs.ts`, import `PRESET_KEYS` from `@chitrapx/document`. Make `designInput` `z.object({ appId: z.uuid(), brief: z.string().max(4000).optional(), preset: z.enum(PRESET_KEYS).optional() })`, and call `appBrief(app, { brief: input.data.brief, preset: input.data.preset })`.

In `apps/web/src/server/ai.ts`:
- Import `PRESET_KEYS`.
- Add `preset: z.enum(PRESET_KEYS).or(z.literal("")).optional(),` to `designInput`.
- In `startAiDesign`, add `if (input.preset !== undefined) patch.preset = input.preset;` to the patch lines.
- Queue `{ appId: app.id, ...(brief && { brief }), ...(saved.preset && { preset: saved.preset }) }`.

- [ ] **Step 5: Preset picker**

In `apps/web/src/components/AiDesignCard.tsx`, extend the `@chitrapx/document` import with `applyPreset, PRESETS, presetFor, type PresetKey`. After the `form` state add:

```tsx
  const [preset, setPreset] = useState<PresetKey | "">(saved.preset ?? "");
  /** Fills empty fields only; a written brief is replaced only after the user says so. */
  function pickPreset(key: PresetKey | "") {
    setPreset(key);
    if (!key) return;
    const p = presetFor(key)!;
    const replace = !!form.text.trim() && form.text.trim() !== p.aiBrief && window.confirm(`Replace your brief with the ${p.label} starter text?`);
    setForm((f) => {
      const { preset: _picked, ...next } = applyPreset(f, key, replace);
      return next;
    });
  }
```

Send `preset` with the rest: `{ brief: form.text, audience: form.audience, tone: form.tone, keywords: keywordList(form.keywords), preset }`. Above the brief `<label>`, add:

```tsx
      <div>
        <label className="label" htmlFor="ai-preset">App type</label>
        <select id="ai-preset" className="input" value={preset} onChange={(e) => pickPreset(e.target.value as PresetKey | "")}>
          <option value="">None</option>
          {PRESETS.map((p) => <option key={p.key} value={p.key} title={p.description}>{p.label}</option>)}
        </select>
      </div>
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/worker exec vitest run test/prompts.test.ts test/ai.test.ts && pnpm --filter @chitrapx/web exec vitest run test/ai.test.ts`
Expected: PASS.

- [ ] **Step 7: Browser check**

Start the web dev server with the dev-server commands in Global Constraints.
- With an empty brief, pick "Finance / Fintech": the brief, the audience and the tone (Calm) fill in.
- Edit the brief and pick "Game / Entertainment": a confirm appears. Cancel keeps your text and only fills the empty fields.
- Submit, then reopen the app: the select still shows Game / Entertainment.

Stop the server by PID.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: the only error is `billing.ts:61`.

```bash
git add packages/document apps/worker apps/web
git commit -m "feat(ai): quick-start presets by app type seed the brief and steer the pick and copy prompts"
```

---

### Task 4: Translation rows, cell states and the one manual writer

**Files:**
- Create: `packages/document/src/hash.ts`, `packages/document/src/translations.ts`
- Modify: `packages/document/src/ai.ts` (`applyTranslations` options and `sourceHash`), `packages/document/src/index.ts`, `packages/renderer/src/osg/i18n/hash.ts` (re-export), `apps/worker/src/ai/jobs.ts` (call site), `apps/web/src/editor/commands.ts` (`setTranslations`)
- Test: `packages/document/test/translations.test.ts` (create), `packages/document/test/ai.test.ts` (modify two cases), `apps/web/test/commands.test.ts` (append)

**Interfaces:**
- Produces (from `@chitrapx/document`):
  - `hash32(input): string`
  - `type TranslationRow = { id; elementId; board; boardId; label; base; source }`, where `source` is what `sourceHash` fingerprints
  - `type CellState = "untranslated" | "auto" | "manual" | "stale-auto" | "stale-manual"`
  - `type TranslationCell = { text; state }`, `type TranslationWrite = { locale; id; text }`
  - `rowLabel(el)`, `translationRows(doc)`, `cellFor(doc, row, locale)`, `localeProgress(doc, locale) -> { translated, total, stale }`
  - `lengthWarning(row, text): string | null`
  - `writeTranslations(doc, writes): ChitrapxDoc`, which returns `doc` itself when nothing changes
  - `type TranslateApply = { sources?: Map<string, string>; sourceLocale?: string; overwriteManual?: boolean }` and `applyTranslations(doc, locale, texts, opts?: TranslateApply)`. The 4th parameter was a `Map`; it is now an options object.
- Editor command: `{ type: "setTranslations"; writes: TranslationWrite[] }`.

- [ ] **Step 1: Failing tests**

`packages/document/test/translations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  applyTranslations, cellFor, hash32, lengthWarning, localeProgress, translationRows, writeTranslations, type ChitrapxDoc,
} from "../src/index.ts";
import { board, doc, group, text } from "./fixtures.ts";

const t = (id: string, content: string, name?: string) => ({ ...text(id, 0, 0), content, name: name ?? "" }) as never;
function project(): ChitrapxDoc {
  const d = doc([group([
    board("b1", [t("h1", "Track every brew", "headline"), t("s1", "  "), t("x1", "Second line of copy here")]),
    board("b2", [t("h2", "Share recipes")]),
  ])]);
  d.groups[0]!.boards[0]!.name = "Screen 1";
  d.groups[0]!.boards[1]!.name = "Screen 2";
  d.localization.locales = [{ code: "de-DE" }, { code: "fr-FR" }];
  return d;
}
const withSize = (d: ChitrapxDoc) => ({ ...d, groups: [...d.groups, { ...structuredClone(d.groups[0]!), id: "g2", target: "ipad-13" as const }] });
const ov = (d: ChitrapxDoc, g: number, b: number, locale: string, id: string) => d.groups[g]!.boards[b]!.localized?.[locale]?.[id];

describe("translation rows", () => {
  it("one row per text, empty texts left out, deduplicated across sizes, labelled by name or text", () => {
    expect(translationRows(withSize(project())).map((r) => [r.id, r.board, r.label, r.base])).toEqual([
      ["h1", "Screen 1", "headline", "Track every brew"],
      ["x1", "Screen 1", "Second line of copy here", "Second line of copy here"],
      ["h2", "Screen 2", "Share recipes", "Share recipes"],
    ]);
  });

  it("cell states: untranslated, auto, manual (no origin counts as manual) and stale once the base changes", () => {
    const d = project();
    d.groups[0]!.boards[0]!.localized = { "de-DE": { h1: { content: "Jeden Brühvorgang", origin: "auto", sourceHash: hash32("Track every brew") }, x1: { content: "Zweite Zeile" } } };
    const [h1, x1, h2] = translationRows(d);
    expect(cellFor(d, h1!, "de-DE")).toEqual({ text: "Jeden Brühvorgang", state: "auto" });
    expect(cellFor(d, x1!, "de-DE")).toEqual({ text: "Zweite Zeile", state: "manual" });
    expect(cellFor(d, h2!, "de-DE")).toEqual({ text: "", state: "untranslated" });
    (d.groups[0]!.boards[0]!.elements[0] as unknown as { content: string }).content = "Track every pour";
    expect(cellFor(d, translationRows(d)[0]!, "de-DE").state).toBe("stale-auto");
    expect(cellFor(d, translationRows(d)[1]!, "de-DE").state).toBe("manual"); // no hash: never stale
  });

  it("counts progress per language", () => {
    const d = project();
    d.groups[0]!.boards[1]!.localized = { "fr-FR": { h2: { content: "Partager", origin: "auto", sourceHash: "00000000" } } };
    expect(localeProgress(d, "fr-FR")).toEqual({ translated: 1, total: 3, stale: 1 });
    expect(localeProgress(d, "de-DE")).toEqual({ translated: 0, total: 3, stale: 0 });
  });

  it("warns when a translation is much longer than its source", () => {
    const [h1] = translationRows(project());
    expect(lengthWarning(h1!, "Jeden Brühvorgang")).toBeNull();
    expect(lengthWarning(h1!, "x".repeat(40))).toBe("Longer than the source; it may shrink or wrap");
  });
});

describe("writeTranslations", () => {
  it("writes a manual, hashed override on every board holding the id, in every size", () => {
    const out = writeTranslations(withSize(project()), [{ locale: "de-DE", id: "h1", text: "Jeden Brühvorgang" }]);
    const want = { content: "Jeden Brühvorgang", origin: "manual", sourceHash: hash32("Track every brew") };
    expect(ov(out, 0, 0, "de-DE", "h1")).toEqual(want);
    expect(ov(out, 1, 0, "de-DE", "h1")).toEqual(want);
  });

  it("'' clears back to the base; unknown and base languages are ignored; nothing to do returns the same document", () => {
    const d = writeTranslations(project(), [{ locale: "de-DE", id: "h1", text: "Jeden" }]);
    expect(ov(writeTranslations(d, [{ locale: "de-DE", id: "h1", text: "" }]), 0, 0, "de-DE", "h1")).toBeUndefined();
    expect(writeTranslations(d, [{ locale: "it", id: "h1", text: "x" }, { locale: "en-US", id: "h1", text: "x" }])).toBe(d);
    expect(writeTranslations(d, [{ locale: "de-DE", id: "h1", text: "Jeden" }])).toBe(d);
  });

  it("carries the language's own marks to the new wording and keeps detached properties", () => {
    const d = project();
    d.groups[0]!.boards[0]!.localized = { "de-DE": { h1: { content: "Jeden Tag", marks: [{ start: 6, end: 9, fontWeight: 800 }], fontSize: 30, detached: ["fontSize"] } } };
    const out = ov(writeTranslations(d, [{ locale: "de-DE", id: "h1", text: "Jeden lieben Tag" }]), 0, 0, "de-DE", "h1")!;
    expect(out).toMatchObject({ content: "Jeden lieben Tag", marks: [{ start: 13, end: 16, fontWeight: 800 }], fontSize: 30, detached: ["fontSize"], origin: "manual" });
  });
});

describe("applyTranslations (SP11)", () => {
  it("records the source hash, keeps manual cells unless told to overwrite them", () => {
    const d = project();
    d.groups[0]!.boards[0]!.localized = { "de-DE": { h1: { content: "Von Hand", origin: "manual" } } };
    const kept = applyTranslations(d, "de-DE", [{ id: "h1", text: "Maschine" }, { id: "h2", text: "Rezepte teilen" }]);
    expect(ov(kept, 0, 0, "de-DE", "h1")).toEqual({ content: "Von Hand", origin: "manual" });
    expect(ov(kept, 0, 1, "de-DE", "h2")).toEqual({ content: "Rezepte teilen", origin: "auto", sourceHash: hash32("Share recipes") });
    const over = applyTranslations(d, "de-DE", [{ id: "h1", text: "Maschine" }], { overwriteManual: true });
    expect(ov(over, 0, 0, "de-DE", "h1")).toEqual({ content: "Maschine", origin: "auto", sourceHash: hash32("Track every brew") });
  });

  it("from another language, a slot whose text in that language changed meanwhile is skipped", () => {
    const d = project();
    d.groups[0]!.boards[0]!.localized = { "fr-FR": { h1: { content: "Suivre chaque café", origin: "auto" } } };
    const sources = new Map([["h1", "Suivre chaque infusion"], ["h2", "Share recipes"]]);
    const out = applyTranslations(d, "de-DE", [{ id: "h1", text: "x" }, { id: "h2", text: "Teilen" }], { sources, sourceLocale: "fr-FR" });
    expect(ov(out, 0, 0, "de-DE", "h1")).toBeUndefined();
    expect(ov(out, 0, 1, "de-DE", "h2")!.content).toBe("Teilen");
  });

  it("skipping a slot leaves no empty language map behind", () => {
    const d = project();
    d.groups[0]!.boards[1]!.localized = { "de-DE": { h2: { content: "Von Hand" } } };
    const out = applyTranslations(d, "de-DE", [{ id: "h1", text: "Verfolgen" }, { id: "h2", text: "x" }]);
    expect(out.groups[0]!.boards[1]!.localized).toEqual({ "de-DE": { h2: { content: "Von Hand" } } });
  });
});

it("hash32 is FNV-1a 32 bit, 8 hex characters", () => {
  expect(hash32("")).toBe("811c9dc5");
  expect(hash32("a")).toBe("e40c292c");
});
```

In `packages/document/test/ai.test.ts`, add `hash32` to the import from `../src/index.ts`, then:
- In "writes automatic overrides, adds the language, and never overwrites a manual edit", change the expectation for `h1` to `toEqual({ content: "Jeden Brühvorgang verfolgen", origin: "auto", sourceHash: hash32("Track every brew") })`.
- In "skips a translation whose source text changed since the job read it", change the call to `applyTranslations(d, "de-DE", [{ id: "h1", text: "Verfolgen" }, { id: "h2", text: "Veraltet" }], { sources })`.

Append to `apps/web/test/commands.test.ts`. Add `import { hash32 } from "@chitrapx/document";` at the top.

```ts
describe("translations table (SP11)", () => {
  it("setTranslations writes a manual, hashed override on every size holding the id, and repeating it is no step", () => {
    const two = doc();
    two.groups.push({ ...structuredClone(two.groups[0]!), id: "g2", target: "ipad-13" });
    const d = applyCommand(two, { type: "setTranslations", writes: [{ locale: "de-DE", id: "a", text: "Hallo" }] });
    const want = { content: "Hallo", origin: "manual", sourceHash: hash32("a") };
    expect(d.groups[0]!.boards[0]!.localized!["de-DE"]!.a).toEqual(want);
    expect(d.groups[1]!.boards[0]!.localized!["de-DE"]!.a).toEqual(want);
    expect(applyCommand(d, { type: "setTranslations", writes: [{ locale: "de-DE", id: "a", text: "Hallo" }] })).toBe(d);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @chitrapx/document exec vitest run test/translations.test.ts test/ai.test.ts`
Expected: FAIL. `translationRows` and `hash32` are not exported, and `applyTranslations` takes a `Map`.

- [ ] **Step 3: Move `hash32`**

`packages/document/src/hash.ts`:

```ts
// Ported from open-screenshot-generator (MIT), src/lib/i18n/hash.ts. Moved here from packages/renderer in SP11
// so every writer of a translation (table, CSV import, AI) records the same fingerprint the renderer checks.
// FNV-1a, 32 bits: compared against a value written seconds earlier, so collision resistance buys nothing.

/** Short stable hex fingerprint of `input`. Always 8 characters. */
export function hash32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
```

Replace the body of `packages/renderer/src/osg/i18n/hash.ts`, keeping its header comment, with:

```ts
export { hash32 } from '@chitrapx/document';
```

- [ ] **Step 4: Rows, cells and the writer**

`packages/document/src/translations.ts`:

```ts
import { produce, type Draft } from "immer";
import type { ArtboardState, ElementLocaleOverride, TextElementProps } from "./artboard.ts";
import type { ChitrapxDoc } from "./doc.ts";
import { hash32 } from "./hash.ts";
import { remapMarks } from "./richText.ts";

/** One text of the translations table. Element ids repeat across sizes, so one id is one row, on the first board it appears on. */
export type TranslationRow = {
  id: string;
  elementId: string;
  board: string;
  boardId: string;
  label: string;
  /** The base-language text of this row. */
  base: string;
  /** What `sourceHash` fingerprints for this row. */
  source: string;
};
export type CellState = "untranslated" | "auto" | "manual" | "stale-auto" | "stale-manual";
export type TranslationCell = { text: string; state: CellState };
/** One typed or imported cell. '' clears it back to the base. */
export type TranslationWrite = { locale: string; id: string; text: string };

const LABEL_LIMIT = 40;

/** The layer name, or the start of the text when nobody named the layer. */
export function rowLabel(el: { name?: string; content?: string }): string {
  const name = el.name?.trim();
  if (name) return name;
  const text = (el.content ?? "").replace(/\s+/g, " ").trim();
  return text.length > LABEL_LIMIT ? `${text.slice(0, LABEL_LIMIT - 1)}…` : text;
}

/** Every localizable text once, in board order of the first size it appears in. Empty texts are not rows. */
export function translationRows(doc: ChitrapxDoc): TranslationRow[] {
  const seen = new Set<string>();
  const rows: TranslationRow[] = [];
  for (const g of doc.groups) for (const b of g.boards) for (const e of b.elements) {
    if (e.type !== "text") continue;
    const t = e as TextElementProps;
    if (!t.content?.trim() || seen.has(t.id)) continue;
    seen.add(t.id);
    rows.push({ id: t.id, elementId: t.id, board: b.name, boardId: b.id, label: rowLabel(t), base: t.content, source: t.content });
  }
  return rows;
}

/** First override per (locale, element id), built once per document; documents are never mutated. */
const indexes = new WeakMap<ChitrapxDoc, Map<string, ElementLocaleOverride>>();
export function overrideOf(doc: ChitrapxDoc, locale: string, elementId: string): ElementLocaleOverride | undefined {
  let index = indexes.get(doc);
  if (!index) {
    index = new Map();
    for (const g of doc.groups) for (const b of g.boards) for (const [loc, byEl] of Object.entries(b.localized ?? {})) {
      for (const [id, ov] of Object.entries(byEl ?? {})) {
        const key = `${loc}\u0000${id}`;
        if (ov && !index.has(key)) index.set(key, ov);
      }
    }
    indexes.set(doc, index);
  }
  return index.get(`${locale}\u0000${elementId}`);
}

function stateOf(ov: ElementLocaleOverride, source: string): CellState {
  // No origin means typed, imported or written by an older build: treated as a person's, never overwritten.
  const kind = ov.origin === "auto" ? "auto" : "manual";
  // No hash means we cannot know, and flagging every legacy translation would teach people to ignore the flag.
  return ov.sourceHash && ov.sourceHash !== hash32(source) ? `stale-${kind}` : kind;
}

export function cellFor(doc: ChitrapxDoc, row: TranslationRow, locale: string): TranslationCell {
  const ov = overrideOf(doc, locale, row.elementId);
  const text = ov?.content ?? "";
  return text.trim() ? { text, state: stateOf(ov!, row.source) } : { text: "", state: "untranslated" };
}

/** The "4/6" and stale count in a language's column header. */
export function localeProgress(doc: ChitrapxDoc, locale: string): { translated: number; total: number; stale: number } {
  const rows = translationRows(doc);
  let translated = 0;
  let stale = 0;
  for (const row of rows) {
    const { state } = cellFor(doc, row, locale);
    if (state === "untranslated") continue;
    translated++;
    if (state.startsWith("stale")) stale++;
  }
  return { translated, total: rows.length, stale };
}

/** Advice under a cell. What renders is still decided by auto-shrink at render time. */
export function lengthWarning(row: TranslationRow, text: string): string | null {
  if (!text) return null;
  return text.length > Math.ceil(row.base.length * 1.5) + 4 ? "Longer than the source; it may shrink or wrap" : null;
}

/** Stores `next` as the override, or removes it and any map it leaves empty. */
function put(b: Draft<ArtboardState>, locale: string, id: string, next: ElementLocaleOverride) {
  const byEl = ((b.localized ??= {})[locale] ??= {});
  if (Object.keys(next).length) byEl[id] = next;
  else delete byEl[id];
  if (!Object.keys(byEl).length) delete b.localized![locale];
  if (!Object.keys(b.localized!).length) delete b.localized;
}

/**
 * The single writer for typed and imported translations: marked manual (a person wrote or reviewed it, so AI
 * translation keeps it) and hashed against today's base text, on every board holding the id. '' clears back to
 * the base. Returns `doc` itself when nothing changes, so a no-op edit adds no undo step.
 */
export function writeTranslations(doc: ChitrapxDoc, writes: TranslationWrite[]): ChitrapxDoc {
  const known = new Set(doc.localization.locales.map((l) => l.code));
  const texts = new Map<string, string>();
  for (const w of writes) if (known.has(w.locale)) texts.set(`${w.locale}\u0000${w.id}`, w.text.replace(/\r\n?/g, "\n"));
  if (!texts.size) return doc;
  return produce(doc, (d) => {
    for (const g of d.groups) for (const b of g.boards) for (const e of b.elements) {
      if (e.type !== "text") continue;
      const base = (e as TextElementProps).content ?? "";
      for (const locale of known) {
        const text = texts.get(`${locale}\u0000${e.id}`);
        const current = b.localized?.[locale]?.[e.id];
        if (text === undefined || (current?.content ?? "") === text) continue;
        const next: ElementLocaleOverride = { ...current };
        if (text === "") {
          delete next.content; delete next.marks; delete next.origin; delete next.sourceHash;
        } else {
          // The language's own marks are offsets into its old wording (or the base, while it had none).
          if (next.marks?.length) {
            const m = remapMarks(current?.content ?? base, text, next.marks);
            if (m.length) next.marks = m; else delete next.marks;
          }
          next.content = text;
          next.origin = "manual";
          next.sourceHash = hash32(base);
        }
        put(b, locale, e.id, next);
      }
    }
  });
}
```

Append `export * from "./hash.ts";` and `export * from "./translations.ts";` to `packages/document/src/index.ts`.

- [ ] **Step 5: `applyTranslations` options and hash**

In `packages/document/src/ai.ts`, add `import { hash32 } from "./hash.ts";` and replace `applyTranslations` with:

```ts
/** How a machine translation lands (SP11). */
export type TranslateApply = {
  /** The text each id had when the job read it. A slot whose text changed since is skipped: its translation is of old words. */
  sources?: Map<string, string>;
  /** The language `sources` was read from; the base when absent. */
  sourceLocale?: string;
  /** Replace translations a person wrote. Default: keep them. */
  overwriteManual?: boolean;
};

/**
 * Writes machine translations as locale overrides marked `origin: "auto"`, hashed against the base text, and adds
 * the language. A slot a person translated (content without `origin: "auto"`) is kept unless `overwriteManual`.
 */
export function applyTranslations(doc: ChitrapxDoc, locale: string, texts: SlotText[], opts: TranslateApply = {}): ChitrapxDoc {
  if (locale === doc.localization.baseLocale) return doc;
  const byId = new Map(texts.map((t) => [t.id, t.text.trim()]));
  const from = opts.sourceLocale && opts.sourceLocale !== doc.localization.baseLocale ? opts.sourceLocale : null;
  return produce(doc, (d) => {
    if (!d.localization.locales.some((l) => l.code === locale)) d.localization.locales.push({ code: locale });
    for (const g of d.groups) for (const b of g.boards) for (const e of b.elements) {
      const text = byId.get(e.id);
      if (text === undefined || e.type !== "text") continue;
      const base = (e as TextElementProps).content ?? "";
      const sourceNow = from ? (b.localized?.[from]?.[e.id]?.content || base) : base;
      if (opts.sources?.has(e.id) && opts.sources.get(e.id) !== sourceNow) continue;
      const current = b.localized?.[locale]?.[e.id];
      if (current?.content !== undefined && current.origin !== "auto" && !opts.overwriteManual) continue; // a person wrote this
      const next = text.slice(0, budget(base));
      // The language's own marks were offsets into its old wording.
      const { marks: old, ...rest } = current ?? {};
      ((b.localized ??= {})[locale] ??= {})[e.id] = {
        ...rest, ...(current?.content === next && old ? { marks: old } : {}), content: next, origin: "auto", sourceHash: hash32(base),
      };
    }
  });
}
```

In `apps/worker/src/ai/jobs.ts`, change the call to `applyTranslations(d, r.locale, r.texts, { sources })`.

- [ ] **Step 6: Editor command**

In `apps/web/src/editor/commands.ts`, add `writeTranslations` and `type TranslationWrite` to the `@chitrapx/document` import and `| { type: "setTranslations"; writes: TranslationWrite[] }` to `Command`. As the first line of `applyCommand`, add:

```ts
  if (cmd.type === "setTranslations") return writeTranslations(doc, cmd.writes);
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/renderer test && pnpm --filter @chitrapx/web exec vitest run test/commands.test.ts && pnpm --filter @chitrapx/worker exec vitest run test/ai.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: the only error is `billing.ts:61`.

```bash
git add packages/document packages/renderer apps/web/src/editor/commands.ts apps/web/test/commands.test.ts apps/worker/src/ai/jobs.ts
git commit -m "feat(i18n): translation rows, cell states and one writer that records origin and source hash"
```

---

### Task 5: CSV and JSON export and import with a preview plan

**Files:**
- Create: `packages/document/src/translationFiles.ts`
- Modify: `packages/document/src/index.ts`, `NOTICES.md` (open-screenshot-generator row)
- Test: `packages/document/test/translationFiles.test.ts` (create)

**Interfaces:**
- Consumes: `translationRows`, `cellFor`, `TranslationWrite` (Task 4).
- Produces:
  - `toCsv(doc): string`: BOM, CRLF, header `id,board,label,<base>,<locales…>`
  - `toJson(doc): string`: `{ [locale]: { [id]: text } }`, base included, only translated cells
  - `type ImportChange = TranslationWrite & { kind: "added" | "changed"; label: string; from: string }`
  - `type ImportPlan = { changes: ImportChange[]; unchanged: number; unknownIds: string[]; unknownLocales: string[] }`
  - `class ImportError extends Error { code: "no_id_column" | "not_json" }`
  - `planCsvImport(doc, text): ImportPlan`, `planJsonImport(doc, text): ImportPlan`
- Applying a plan is `writeTranslations(doc, plan.changes)`, which in the editor is the `setTranslations` command.

- [ ] **Step 1: Failing tests**

`packages/document/test/translationFiles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ImportError, planCsvImport, planJsonImport, toCsv, toJson, writeTranslations, type ChitrapxDoc } from "../src/index.ts";
import { board, doc, group, text } from "./fixtures.ts";

const t = (id: string, content: string, name = "") => ({ ...text(id, 0, 0), content, name }) as never;
function project(): ChitrapxDoc {
  const d = doc([group([
    board("b1", [t("h1", 'Track, every "brew"', "headline"), t("s1", "Line one\nLine two", "sub")]),
    board("b2", [t("h2", "Share recipes")]),
  ])]);
  d.groups[0]!.boards[0]!.name = "Screen 1";
  d.groups[0]!.boards[1]!.name = "Screen 2";
  d.localization.locales = [{ code: "de-DE" }, { code: "fr-FR" }];
  d.groups[0]!.boards[0]!.localized = { "de-DE": { h1: { content: 'Jeden "Brühvorgang", verfolgen', origin: "auto" }, s1: { content: "Zeile eins\nZeile zwei", origin: "manual" } } };
  d.groups[0]!.boards[1]!.localized = { "fr-FR": { h2: { content: "Partager", origin: "auto" } } };
  return d;
}
const empty = { changes: [], unchanged: 3, unknownIds: [], unknownLocales: [] };

describe("CSV", () => {
  it("is UTF-8 with a BOM, CRLF and RFC 4180 quoting, one row per text", () => {
    const csv = toCsv(project());
    expect(csv.startsWith("﻿id,board,label,en-US,de-DE,fr-FR\r\n")).toBe(true);
    expect(csv).toContain('h1,Screen 1,headline,"Track, every ""brew""","Jeden ""Brühvorgang"", verfolgen",\r\n');
    expect(csv).toContain('s1,Screen 1,sub,"Line one\nLine two","Zeile eins\nZeile zwei",\r\n');
    expect(csv.endsWith("h2,Screen 2,Share recipes,Share recipes,,Partager\r\n")).toBe(true);
  });

  it("round-trips: importing what was exported changes nothing", () => {
    expect(planCsvImport(project(), toCsv(project()))).toEqual(empty);
  });

  it("two cells changed in a spreadsheet are exactly two changes, and applying them writes only those", () => {
    const d = project();
    const edited = toCsv(d).replace("Share recipes,,Partager\r\n", "Share recipes,,Partagez vos recettes\r\n")
      .replace('verfolgen",\r\ns1', 'verfolgen",Suivre chaque café\r\ns1');
    const plan = planCsvImport(d, edited);
    expect(plan.changes).toEqual([
      { locale: "fr-FR", id: "h1", text: "Suivre chaque café", from: "", label: "headline", kind: "added" },
      { locale: "fr-FR", id: "h2", text: "Partagez vos recettes", from: "Partager", label: "Share recipes", kind: "changed" },
    ]);
    expect(plan.unchanged).toBe(2);
    const out = writeTranslations(d, plan.changes);
    expect(out.groups[0]!.boards[0]!.localized!["de-DE"]).toEqual(d.groups[0]!.boards[0]!.localized!["de-DE"]);
    expect(out.groups[0]!.boards[0]!.localized!["fr-FR"]!.h1).toMatchObject({ content: "Suivre chaque café", origin: "manual" });
    expect(out.groups[0]!.boards[1]!.localized!["fr-FR"]!.h2).toMatchObject({ content: "Partagez vos recettes", origin: "manual" });
  });

  it("reports unknown ids and language columns and still imports the rest; a blank never clears", () => {
    const d = project();
    const sheet = ["id,board,label,en-US,de-DE,it", "zz9,Gone,old,Old,Alt,Vecchio", "h2,Screen 2,x,Share recipes,Teilen,Condividi", "h1,Screen 1,x,x,,"].join("\n");
    const plan = planCsvImport(d, sheet);
    expect(plan.unknownIds).toEqual(["zz9"]);
    expect(plan.unknownLocales).toEqual(["it"]);
    expect(plan.changes).toEqual([{ locale: "de-DE", id: "h2", text: "Teilen", from: "", label: "Share recipes", kind: "added" }]);
  });

  it("refuses a sheet with no id column", () => {
    expect(() => planCsvImport(project(), "board,label\nScreen 1,x")).toThrow(ImportError);
    try { planCsvImport(project(), "board,label\nScreen 1,x"); } catch (err) { expect((err as ImportError).code).toBe("no_id_column"); }
  });
});

describe("JSON", () => {
  it("is { locale: { id: text } } with the base and only translated cells, and round-trips", () => {
    const json = JSON.parse(toJson(project()));
    expect(json["en-US"]).toEqual({ h1: 'Track, every "brew"', s1: "Line one\nLine two", h2: "Share recipes" });
    expect(json["fr-FR"]).toEqual({ h2: "Partager" });
    expect(planJsonImport(project(), toJson(project()))).toEqual(empty);
  });

  it("plans changes, reports unknown ids and languages, and refuses other shapes", () => {
    const plan = planJsonImport(project(), JSON.stringify({ "de-DE": { h2: "Teilen", nope: "x" }, it: { h1: "x" } }));
    expect(plan.changes).toEqual([{ locale: "de-DE", id: "h2", text: "Teilen", from: "", label: "Share recipes", kind: "added" }]);
    expect(plan.unknownIds).toEqual(["nope"]);
    expect(plan.unknownLocales).toEqual(["it"]);
    for (const bad of ["not json", "[]", '{"de-DE":["x"]}', '{"de-DE":{"h1":3}}']) {
      expect(() => planJsonImport(project(), bad), bad).toThrow(ImportError);
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @chitrapx/document exec vitest run test/translationFiles.test.ts`
Expected: FAIL. `toCsv` is not exported.

- [ ] **Step 3: Implement**

`packages/document/src/translationFiles.ts`:

```ts
// RFC 4180 field quoting and the CSV parser are ported from open-screenshot-generator (MIT),
// src/lib/i18n/translationCsv.ts (csvField, parseCsv). Columns, id matching and the import plan are Chitrapx's own.
import type { ChitrapxDoc } from "./doc.ts";
import { cellFor, translationRows, type TranslationWrite } from "./translations.ts";

export type ImportChange = TranslationWrite & { kind: "added" | "changed"; label: string; from: string };
export type ImportPlan = { changes: ImportChange[]; unchanged: number; unknownIds: string[]; unknownLocales: string[] };
export class ImportError extends Error {
  constructor(public code: "no_id_column" | "not_json") { super(code); }
}

const PEOPLE_COLUMNS = ["id", "board", "label"];

/** Quote when the field holds a delimiter, doubling the quotes. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A real parser: translated headlines contain commas, and spreadsheets quote cells that hold line breaks. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // Excel writes a BOM on UTF-8 CSVs; it would otherwise stick to the first header name.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endRow = () => { row.push(field); field = ""; rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === "") { quoted = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { endRow(); i += text[i + 1] === "\n" ? 2 : 1; continue; }
    if (ch === "\n") { endRow(); i++; continue; }
    field += ch; i++;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows.filter((cells) => cells.some((c) => c.trim() !== ""));
}

/** Texts store "\n"; a cell that came back with CRLF must compare equal. */
const normalizeCell = (v: string | undefined) => (v ?? "").replace(/\r\n?/g, "\n");

/** One row per text, then the base column and one column per language. BOM and CRLF, so Excel opens it as written. */
export function toCsv(doc: ChitrapxDoc): string {
  const locales = doc.localization.locales.map((l) => l.code);
  const lines = [[...PEOPLE_COLUMNS, doc.localization.baseLocale, ...locales].map(csvField).join(",")];
  for (const row of translationRows(doc)) {
    lines.push([row.id, row.board, row.label, row.base, ...locales.map((l) => cellFor(doc, row, l).text)].map(csvField).join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** The base language and every translated cell; untranslated cells are left out. */
export function toJson(doc: ChitrapxDoc): string {
  const rows = translationRows(doc);
  const out: Record<string, Record<string, string>> = { [doc.localization.baseLocale]: Object.fromEntries(rows.map((r) => [r.id, r.base])) };
  for (const { code } of doc.localization.locales) {
    out[code] = Object.fromEntries(rows.flatMap((r) => { const c = cellFor(doc, r, code); return c.text ? [[r.id, c.text]] : []; }));
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** Compares incoming cells with what is stored. An empty cell is skipped: a blank never deletes a translation. */
function plan(doc: ChitrapxDoc, entries: Array<{ id: string; values: Array<{ locale: string; text: string }> }>, unknownLocales: string[]): ImportPlan {
  const rows = new Map(translationRows(doc).map((r) => [r.id, r]));
  const changes: ImportChange[] = [];
  const unknownIds: string[] = [];
  let unchanged = 0;
  for (const { id, values } of entries) {
    const row = rows.get(id);
    if (!row) { if (!unknownIds.includes(id)) unknownIds.push(id); continue; }
    for (const { locale, text } of values) {
      if (text === "") continue;
      const from = cellFor(doc, row, locale).text;
      if (from === text) { unchanged++; continue; }
      changes.push({ locale, id, text, from, label: row.label, kind: from ? "changed" : "added" });
    }
  }
  return { changes, unchanged, unknownIds, unknownLocales };
}

export function planCsvImport(doc: ChitrapxDoc, text: string): ImportPlan {
  const table = parseCsv(text);
  if (!table.length) return { changes: [], unchanged: 0, unknownIds: [], unknownLocales: [] };
  const header = table[0]!.map((h) => h.trim());
  const idCol = header.findIndex((h) => h.toLowerCase() === "id");
  if (idCol < 0) throw new ImportError("no_id_column");
  const base = doc.localization.baseLocale;
  const known = new Set(doc.localization.locales.map((l) => l.code));
  const columns = header.flatMap((h, col) => (known.has(h) ? [{ locale: h, col }] : []));
  const unknownLocales = header.filter((h) => h && !PEOPLE_COLUMNS.includes(h.toLowerCase()) && h !== base && !known.has(h));
  const entries = table.slice(1).flatMap((cells) => {
    const id = (cells[idCol] ?? "").trim();
    return id ? [{ id, values: columns.map(({ locale, col }) => ({ locale, text: normalizeCell(cells[col]) })) }] : [];
  });
  return plan(doc, entries, unknownLocales);
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function planJsonImport(doc: ChitrapxDoc, text: string): ImportPlan {
  let data: unknown;
  try { data = JSON.parse(text.replace(/^﻿/, "")); } catch { throw new ImportError("not_json"); }
  if (!isRecord(data) || !Object.values(data).every((m) => isRecord(m) && Object.values(m).every((t) => typeof t === "string"))) {
    throw new ImportError("not_json");
  }
  const base = doc.localization.baseLocale;
  const known = new Set(doc.localization.locales.map((l) => l.code));
  const unknownLocales = Object.keys(data).filter((l) => l !== base && !known.has(l));
  const byId = new Map<string, Array<{ locale: string; text: string }>>();
  for (const [locale, map] of Object.entries(data as Record<string, Record<string, string>>)) {
    if (locale !== base && !known.has(locale)) continue;
    for (const [id, value] of Object.entries(map)) {
      const list = byId.get(id) ?? [];
      if (locale !== base) list.push({ locale, text: normalizeCell(value) });
      byId.set(id, list);
    }
  }
  return plan(doc, [...byId].map(([id, values]) => ({ id, values })), unknownLocales);
}
```

Append `export * from "./translationFiles.ts";` to `packages/document/src/index.ts`.

Append to the open-screenshot-generator row's "Reused material" cell in `NOTICES.md`: `SP11: the CSV parser and RFC 4180 field quoting (`packages/document/src/translationFiles.ts`, from `src/lib/i18n/translationCsv.ts`); the FNV-1a source fingerprint, moved to `packages/document/src/hash.ts`.`

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @chitrapx/document test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/document NOTICES.md
git commit -m "feat(i18n): CSV and JSON translation export and import with a preview plan"
```

---

### Task 6: The translations table in the editor

**Files:**
- Create: `apps/web/src/editor/translationsModel.ts`, `apps/web/src/editor/ui/TranslationsTable.tsx`
- Modify: `apps/web/src/editor/ui/Toolbar.tsx` (button and dialog), `apps/web/src/editor/Editor.tsx` (`openTranslations`), `apps/web/src/app/editor/[projectId]/page.tsx` (`searchParams`), `apps/web/src/components/ProjectAi.tsx` (link)
- Test: `apps/web/test/translationsModel.test.ts` (create)

**Interfaces:**
- Consumes: `translationRows`, `cellFor`, `localeProgress`, `lengthWarning`, `toCsv`, `toJson`, `planCsvImport`, `planJsonImport`, `ImportError` (Tasks 4–5); the `setTranslations` command.
- Produces:
  - `type LocaleInfo = (code: string) => { name: string; rtl: boolean }`
  - `type Column = { code; name; rtl; translated; total; stale }`
  - `type TableRow = { row: TranslationRow; cells: Record<string, TranslationCell> }`
  - `type TableModel = { base: { code; name; rtl }; columns: Column[]; sections: Array<{ boardId; board; rows: TableRow[] }> }`
  - `tableModel(doc, info, filter?: "all" | "missing"): TableModel`
  - `TranslationsTable({ name, onClose })`
  - `Toolbar` and `Editor` props gain `openTranslations?: boolean`.

- [ ] **Step 1: Failing test**

`apps/web/test/translationsModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ArtboardElement, ChitrapxDoc } from "@chitrapx/document";
import { tableModel } from "@/editor/translationsModel.ts";

const info = (code: string) => ({ name: code.toUpperCase(), rtl: code === "ar-SA" });
const t = (id: string, content: string) => ({ id, type: "text", name: "", content, fontSize: 40, fontFamily: "Inter", color: "#000",
  position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, rotation: 0, scale: 1 }) as unknown as ArtboardElement;
function doc(): ChitrapxDoc {
  return {
    schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [{ code: "de-DE" }, { code: "ar-SA" }] },
    groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards: [
      { id: "b1", name: "Screen 1", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1,
        elements: [t("h1", "Track habits"), t("s1", "Every day")], localized: { "de-DE": { h1: { content: "Gewohnheiten", origin: "auto" } } } },
      { id: "b2", name: "Screen 2", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1, elements: [t("h2", "Share")] },
    ] }],
  };
}

describe("translations table model", () => {
  it("columns carry progress and the RTL flag; rows are grouped by board", () => {
    const m = tableModel(doc(), info);
    expect(m.base).toEqual({ code: "en-US", name: "EN-US", rtl: false });
    expect(m.columns).toEqual([
      { code: "de-DE", name: "DE-DE", rtl: false, translated: 1, total: 3, stale: 0 },
      { code: "ar-SA", name: "AR-SA", rtl: true, translated: 0, total: 3, stale: 0 },
    ]);
    expect(m.sections.map((s) => [s.board, s.rows.map((r) => r.row.id)])).toEqual([["Screen 1", ["h1", "s1"]], ["Screen 2", ["h2"]]]);
    expect(m.sections[0]!.rows[0]!.cells["de-DE"]).toEqual({ text: "Gewohnheiten", state: "auto" });
  });

  it("the missing filter keeps only rows with an untranslated or stale cell", () => {
    const d = doc();
    d.localization.locales = [{ code: "de-DE" }];
    d.groups[0]!.boards[0]!.localized!["de-DE"]!.s1 = { content: "Jeden Tag", origin: "manual" };
    d.groups[0]!.boards[1]!.localized = { "de-DE": { h2: { content: "Teilen", origin: "auto", sourceHash: "00000000" } } };
    expect(tableModel(d, info, "missing").sections.flatMap((s) => s.rows.map((r) => r.row.id))).toEqual(["h2"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @chitrapx/web exec vitest run test/translationsModel.test.ts`
Expected: FAIL. The module does not exist.

- [ ] **Step 3: Model**

`apps/web/src/editor/translationsModel.ts`:

```ts
import { cellFor, localeProgress, translationRows, type ChitrapxDoc, type TranslationCell, type TranslationRow } from "@chitrapx/document";

/** Display name and direction of a locale code (the component passes the renderer's LOCALES). */
export type LocaleInfo = (code: string) => { name: string; rtl: boolean };
export type Column = { code: string; name: string; rtl: boolean; translated: number; total: number; stale: number };
export type TableRow = { row: TranslationRow; cells: Record<string, TranslationCell> };
export type TableModel = { base: { code: string; name: string; rtl: boolean }; columns: Column[]; sections: Array<{ boardId: string; board: string; rows: TableRow[] }> };

/** What the translations table draws: the base column, one column per language with its progress, rows grouped by board. */
export function tableModel(doc: ChitrapxDoc, info: LocaleInfo, filter: "all" | "missing" = "all"): TableModel {
  const codes = doc.localization.locales.map((l) => l.code);
  const columns = codes.map((code) => ({ code, ...info(code), ...localeProgress(doc, code) }));
  const sections: TableModel["sections"] = [];
  for (const row of translationRows(doc)) {
    const cells = Object.fromEntries(codes.map((c) => [c, cellFor(doc, row, c)]));
    if (filter === "missing" && !Object.values(cells).some((c) => c.state === "untranslated" || c.state.startsWith("stale"))) continue;
    const last = sections.at(-1);
    if (last?.boardId === row.boardId) last.rows.push({ row, cells });
    else sections.push({ boardId: row.boardId, board: row.board, rows: [{ row, cells }] });
  }
  return { base: { code: doc.localization.baseLocale, ...info(doc.localization.baseLocale) }, columns, sections };
}
```

- [ ] **Step 4: The dialog**

`apps/web/src/editor/ui/TranslationsTable.tsx`:

```tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { ImportError, lengthWarning, planCsvImport, planJsonImport, toCsv, toJson, type CellState, type ImportPlan } from "@chitrapx/document";
import { LOCALES } from "@chitrapx/renderer";
import { useEditor, useEditorStore } from "../context.tsx";
import { tableModel } from "../translationsModel.ts";

const CELL_CLASS: Record<CellState, string> = {
  untranslated: "border-amber-400 bg-amber-50 dark:bg-amber-950",
  "stale-auto": "border-orange-500 bg-orange-50 dark:bg-orange-950",
  "stale-manual": "border-orange-500 bg-orange-50 dark:bg-orange-950",
  auto: "border-neutral-300 dark:border-neutral-700",
  manual: "border-indigo-300 dark:border-indigo-800",
};
const CELL_TITLE: Record<CellState, string> = {
  untranslated: "Not translated: the base text shows in this language",
  "stale-auto": "The source changed since this was machine translated",
  "stale-manual": "The source changed since this was written",
  auto: "Machine translated",
  manual: "Written by hand: AI translation keeps it",
};
const IMPORT_ERRORS = {
  no_id_column: "This CSV has no id column. Export a CSV first and edit that.",
  not_json: "This is not a translations file. It should look like { \"de-DE\": { \"<id>\": \"text\" } }.",
} as const;

const localeInfo = (code: string) => {
  const def = LOCALES.find((l) => l.code === code);
  return { name: def?.nativeName ?? code, rtl: !!def?.rtl };
};

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

/** Every text in every language. Cell edits and imports are one undo step each; autosave stores them. */
export function TranslationsTable({ name, onClose }: { name: string; onClose: () => void }) {
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const locked = useEditor((s) => s.locked);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const model = useMemo(() => tableModel(doc, localeInfo, onlyMissing ? "missing" : "all"), [doc, onlyMissing]);
  const write = (locale: string, id: string, text: string) =>
    store.getState().apply({ type: "setTranslations", writes: [{ locale, id, text }] });

  async function pick(f: File) {
    setError("");
    setPlan(null);
    try {
      const text = await f.text();
      const doc = store.getState().doc;
      setPlan(/\.json$/i.test(f.name) ? planJsonImport(doc, text) : planCsvImport(doc, text));
    } catch (err) {
      setError(err instanceof ImportError ? IMPORT_ERRORS[err.code] : "Could not read this file.");
    } finally {
      if (file.current) file.current.value = "";
    }
  }

  function applyPlan() {
    if (plan?.changes.length) store.getState().apply({ type: "setTranslations", writes: plan.changes });
    setPlan(null);
  }

  const added = plan?.changes.filter((c) => c.kind === "added").length ?? 0;
  return (
    <div role="dialog" aria-modal="true" aria-label="Translations" className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col gap-3 overflow-hidden rounded-lg bg-white p-4 shadow-xl dark:bg-neutral-900">
        <header className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">Translations</h2>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Only missing or stale
          </label>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => download(`${name}-translations.csv`, toCsv(doc), "text/csv;charset=utf-8")}>Export CSV</button>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => download(`${name}-translations.json`, toJson(doc), "application/json")}>Export JSON</button>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={locked} onClick={() => file.current?.click()}>Import CSV or JSON</button>
          <input ref={file} type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
          <button type="button" className="btn px-2 py-1 text-xs" onClick={onClose}>Done</button>
        </header>

        {error && <p role="alert" className="error text-xs">{error}</p>}
        {plan && (
          <section className="space-y-2 rounded-md border border-indigo-200 p-3 text-xs dark:border-indigo-900" aria-label="Import preview">
            <p>
              {added} added, {plan.changes.length - added} changed, {plan.unchanged} unchanged.
              {plan.unknownIds.length > 0 && <> Not in this project (skipped): {plan.unknownIds.join(", ")}.</>}
              {plan.unknownLocales.length > 0 && <> Languages not in this project (skipped): {plan.unknownLocales.join(", ")}.</>}
            </p>
            {plan.changes.length > 0 && (
              <ul className="max-h-40 overflow-auto">
                {plan.changes.map((c) => (
                  <li key={`${c.locale}:${c.id}`}><b>{c.label}</b> ({c.locale}): <s className="text-neutral-500">{c.from || "empty"}</s> → <span dir="auto">{c.text}</span></li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <button type="button" className="btn px-2 py-1" disabled={!plan.changes.length || locked} onClick={applyPlan}>Apply {plan.changes.length} changes</button>
              <button type="button" className="btn-ghost px-2 py-1" onClick={() => setPlan(null)}>Cancel</button>
            </div>
          </section>
        )}

        {model.columns.length === 0 ? (
          <p className="text-sm text-neutral-500">Add a language in the toolbar to start translating.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-white dark:bg-neutral-900">
                <tr>
                  <th className="p-1 text-left">Text</th>
                  <th className="p-1 text-left">{model.base.name} <span className="text-neutral-500">({model.base.code})</span></th>
                  {model.columns.map((c) => (
                    <th key={c.code} className="p-1 text-left">
                      {c.name} <span className="text-neutral-500">({c.code})</span>
                      {c.rtl && <span className="ml-1 rounded bg-neutral-200 px-1 text-[9px] font-semibold dark:bg-neutral-700" title="Right-to-left">RTL</span>}
                      <div className="font-normal text-neutral-500">{c.translated}/{c.total}{c.stale ? `, ${c.stale} stale` : ""}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.sections.map((s) => [
                  <tr key={s.boardId}><td colSpan={model.columns.length + 2} className="bg-neutral-100 p-1 font-semibold dark:bg-neutral-800">{s.board}</td></tr>,
                  ...s.rows.map(({ row, cells }) => (
                    <tr key={row.id} className="align-top">
                      <td className="w-32 p-1 text-neutral-600 dark:text-neutral-400">{row.label}</td>
                      <td className="w-56 whitespace-pre-wrap p-1" dir="auto">{row.base}</td>
                      {model.columns.map((c) => {
                        const cell = cells[c.code]!;
                        const warning = lengthWarning(row, cell.text);
                        return (
                          <td key={c.code} className="min-w-48 p-1">
                            <textarea key={`${row.id}:${c.code}:${cell.text}`} dir="auto" rows={2} defaultValue={cell.text} disabled={locked}
                              aria-label={`${row.label} in ${c.code}`} title={CELL_TITLE[cell.state]} placeholder={row.base}
                              className={`input w-full resize-y border px-1 py-0.5 text-xs ${CELL_CLASS[cell.state]}`}
                              onBlur={(e) => e.target.value !== cell.text && write(c.code, row.id, e.target.value)} />
                            {warning && <p className="text-[10px] text-amber-700 dark:text-amber-300">{warning}</p>}
                          </td>
                        );
                      })}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Open it from the toolbar, the URL and the project page**

In `apps/web/src/editor/ui/Toolbar.tsx`:
- Add `import { TranslationsTable } from "./TranslationsTable.tsx";`.
- Add `openTranslations?: boolean` to the props type and destructuring.
- Add `const [translating, setTranslating] = useState(!!openTranslations);`.
- Before the History button, add:

```tsx
      <button type="button" className="btn-ghost py-1.5" disabled={!doc.groups.length} onClick={() => setTranslating(true)}>Translations</button>
      {translating && <TranslationsTable name={name} onClose={() => setTranslating(false)} />}
```

In `apps/web/src/editor/Editor.tsx`, add `openTranslations?: boolean` to the props and pass `openTranslations={openTranslations}` to `<Toolbar>`.

In `apps/web/src/app/editor/[projectId]/page.tsx`, change the signature to `export default async function EditorPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ translations?: string }> })`. Pass `openTranslations={(await searchParams).translations === "1"}` to `<Editor>`.

In `apps/web/src/components/ProjectAi.tsx`, after the translate button's `</div>`, add:

```tsx
      <Link href={`/editor/${projectId}?translations=1`} className="text-sm text-indigo-600 hover:underline">Open the translations table</Link>
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @chitrapx/web exec vitest run test/translationsModel.test.ts test/commands.test.ts`
Expected: PASS.

- [ ] **Step 7: Browser check**

Start the web dev server with the dev-server commands in Global Constraints. Open a project with three languages (add `de-DE`, `fr-FR`, `ar-SA` from the toolbar).
- "Translations" lists every text in every language. Empty cells are amber, `ar-SA` has an `RTL` badge, and every header shows `0/N`.
- Type a German headline and click away: the cell turns indigo (hand-written) and the header shows `1/N`. Reload: the edit is still there, and Undo removes it in one step.
- Export CSV and open it in a spreadsheet. Change two cells, add a row with id `zz9`, save as CSV and import it: the preview says "1 added, 1 changed" (or "2 changed"), lists `zz9` as skipped, and Apply updates only those two cells.
- Change an English headline in the inspector: its German cell turns orange.
- Open `/editor/<id>?translations=1` directly: the table is open. The project page's "Open the translations table" link does the same.

Stop the server by PID.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: the only error is `billing.ts:61`.

```bash
git add apps/web
git commit -m "feat(editor): translations table with inline editing, progress per language and CSV/JSON import preview"
```

---

### Task 7: AI translation from any language, keep or overwrite hand-written cells, glossary

**Files:**
- Create: `apps/web/src/lib/followJob.ts`, `apps/web/src/editor/docJobs.tsx`
- Modify: `packages/document/src/translations.ts` (`textsIn`), `apps/web/src/server/ai.ts` (`translateInput`, `startTranslate`), `apps/worker/src/ai/jobs.ts` (`translateInput`, `runAiTranslate`), `apps/worker/src/ai/prompts.ts` (`translateSystem`)
- Modify: `apps/web/src/editor/ui/TranslationsTable.tsx` (AI section, glossary), `apps/web/src/editor/Editor.tsx` (`DocJobProvider`, `glossary`), `apps/web/src/editor/ui/Toolbar.tsx`, `apps/web/src/app/editor/[projectId]/page.tsx`
- Test: `packages/document/test/translations.test.ts` (append), `apps/web/test/followJob.test.ts` (create), `apps/web/test/ai.test.ts` (append), `apps/worker/test/ai.test.ts` (append)

**Interfaces:**
- Produces:
  - `textsIn(doc, locale): SlotText[]` (`allTexts` with that language's text where it has one)
  - `startTranslate(ctx, boss, projectId, { locales, sourceLocale?, overwriteManual? })`
  - errors `unknown_source_locale`, `source_in_targets`
  - job input `{ locales, sourceLocale?, overwriteManual? }`
  - `translateSystem(localeName, glossary, sourceName?)`
  - `type FollowedJob = { id; status; error; output }`, `followJob(jobId, everyMs?, tries?): Promise<FollowedJob>`
  - `DocJobProvider({ flush, adoptServerDoc, children })`, `useDocJob(): (start: () => Promise<{ jobId: string }>) => Promise<FollowedJob>`
  - `Editor`, `Toolbar` and `TranslationsTable` gain `glossary: string[]`.
- Consumes: `apps.glossary` (Task 1), `applyTranslations(..., { sources, sourceLocale, overwriteManual })` (Task 4).

- [ ] **Step 1: Failing tests**

Append to `packages/document/test/translations.test.ts`. Add `textsIn` to its import.

```ts
describe("textsIn", () => {
  it("reads a language's own text, and the base where it has none", () => {
    const d = project();
    d.groups[0]!.boards[0]!.localized = { "fr-FR": { h1: { content: "Suivre chaque café" }, x1: { content: "  " } } };
    expect(textsIn(d, "fr-FR").filter((x) => x.text.trim())).toEqual([
      { id: "h1", text: "Suivre chaque café" }, { id: "x1", text: "Second line of copy here" }, { id: "h2", text: "Share recipes" },
    ]);
    expect(textsIn(d, "en-US").find((x) => x.id === "h1")!.text).toBe("Track every brew");
  });
});
```

`apps/web/test/followJob.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { followJob } from "@/lib/followJob.ts";

afterEach(() => vi.unstubAllGlobals());

describe("followJob", () => {
  it("polls the one job until it is done or failed", async () => {
    const answers = [{ status: "queued" }, { status: "running" }, { status: "done", output: { locales: ["de-DE"] } }];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "j", error: null, output: null, ...answers.shift() })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await followJob("j", 1)).toMatchObject({ status: "done", output: { locales: ["de-DE"] } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/jobs/j");
  });

  it("gives up after the last try", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "j", status: "queued", error: null, output: null }))));
    await expect(followJob("j", 1, 3)).rejects.toThrow("taking longer");
  });
});
```

Append to `apps/web/test/ai.test.ts`:

```ts
describe("translate from any language (SP11)", () => {
  it("takes a project language as the source, refuses an unknown one or one that is also a target, and passes overwriteManual", async () => {
    const s = await setup(20);
    const p = await createProject(s.ctx, s.app.id, { name: "T", templateSlug: "amoura-dating" });
    const row = (await db.select().from(schema.projects).where(eq(schema.projects.id, p.id)))[0]!;
    await db.update(schema.projects).set({ doc: { ...(row.doc as object), localization: { baseLocale: "en-US", locales: [{ code: "fr-FR" }] } } }).where(eq(schema.projects.id, p.id));
    const inputOf = async (jobId: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)))[0]!.input;

    await expect(startTranslate(s.ctx, boss, p.id, { locales: ["de-DE"], sourceLocale: "it" })).rejects.toMatchObject({ code: "unknown_source_locale" });
    await expect(startTranslate(s.ctx, boss, p.id, { locales: ["fr-FR"], sourceLocale: "fr-FR" })).rejects.toMatchObject({ code: "source_in_targets" });
    const a = await startTranslate(s.ctx, boss, p.id, { locales: ["ar-SA", "de-DE"], sourceLocale: "fr-FR", overwriteManual: true });
    expect(await inputOf(a.jobId)).toEqual({ locales: ["ar-SA", "de-DE"], sourceLocale: "fr-FR", overwriteManual: true });
    expect(await balance(db, s.ctx.workspaceId)).toBe(16);
    const b = await startTranslate(s.ctx, boss, p.id, { locales: ["de-DE"], sourceLocale: "en-US" });
    expect(await inputOf(b.jobId)).toEqual({ locales: ["de-DE"] });
  });
});
```

Append to `apps/worker/test/ai.test.ts`. Add `allTexts` to the `@chitrapx/document` import.

```ts
describe("translate from another language (SP11)", () => {
  /** amoura with every text in French; the first one also hand-written in Arabic and German. */
  async function frenchProject(s: Awaited<ReturnType<typeof setup>>) {
    const [t] = await db.select().from(schema.templates).where(eq(schema.templates.slug, "amoura-dating"));
    const doc = migrate(t!.doc);
    for (const g of doc.groups) for (const b of g.boards) for (const e of b.elements) {
      if (e.type === "text") ((b.localized ??= {})["fr-FR"] ??= {})[e.id] = { content: `FR ${(e as unknown as { content: string }).content}`, origin: "auto" };
    }
    const b0 = doc.groups[0]!.boards[0]!;
    const firstId = b0.elements.find((e) => e.type === "text")!.id;
    b0.localized!["ar-SA"] = { [firstId]: { content: "مكتوب يدويا", origin: "manual" } };
    b0.localized!["de-DE"] = { [firstId]: { content: "Von Hand", origin: "manual" } };
    doc.localization.locales = [{ code: "fr-FR" }, { code: "ar-SA" }, { code: "de-DE" }];
    await db.update(schema.projects).set({ doc }).where(eq(schema.projects.id, s.project.id));
    return { doc, firstId };
  }

  it("translates ar-SA and de-DE from fr-FR, keeps the hand-written cell, and charges only the language that came back", async () => {
    const s = await setup(1);
    await db.update(schema.apps).set({ glossary: ["Pour-over Pro"] }).where(eq(schema.apps.id, s.app.id));
    const { doc, firstId } = await frenchProject(s);
    const { model, calls } = fakeModel((req) => {
      const sent = JSON.parse((req.content[0] as { text: string }).text) as Array<{ id: string; text: string }>;
      if (req.system.includes("German")) return { texts: [] }; // German fails: skipped, not charged
      return { texts: sent.map((x) => ({ id: x.id, text: `AR ${x.text}` })) };
    });
    const jobId = await queue(s.ws, s.project.id, "ai_translate", { locales: ["ar-SA", "de-DE"], sourceLocale: "fr-FR" }, 4);
    await runJob(jobId, (input, job) => runAiTranslate(input, job, deps(model)));

    expect(await jobRow(jobId)).toMatchObject({ status: "done", output: { locales: ["ar-SA"], skipped: ["de-DE"] } });
    expect(calls.every((c) => c.system.includes("from French") && c.system.includes('"Pour-over Pro"') && c.system.includes('"Bloom"'))).toBe(true);
    const sent = JSON.parse((calls[0]!.content[0] as { text: string }).text) as Array<{ text: string }>;
    expect(sent.every((x) => x.text.startsWith("FR "))).toBe(true);
    const out = (await projectRow(s.project.id)).doc as ChitrapxDoc;
    expect(out.groups[0]!.boards[0]!.localized!["ar-SA"]![firstId]).toEqual({ content: "مكتوب يدويا", origin: "manual" });
    const other = allTexts(doc).find((x) => x.id !== firstId && x.text.trim())!;
    const where = out.groups[0]!.boards.find((b) => b.elements.some((e) => e.id === other.id))!;
    expect(where.localized!["ar-SA"]![other.id]!.content).toMatch(/^AR FR /);
    expect(await balance(db, s.ws)).toBe(28);
  });

  it("overwriteManual replaces a hand-written cell", async () => {
    const s = await setup(1);
    const { firstId } = await frenchProject(s);
    const { model } = fakeModel((req) => ({ texts: (JSON.parse((req.content[0] as { text: string }).text) as Array<{ id: string; text: string }>).map((x) => ({ id: x.id, text: `[de] ${x.text}` })) }));
    const jobId = await queue(s.ws, s.project.id, "ai_translate", { locales: ["de-DE"], overwriteManual: true }, 2);
    await runJob(jobId, (input, job) => runAiTranslate(input, job, deps(model)));
    const out = (await projectRow(s.project.id)).doc as ChitrapxDoc;
    expect(out.groups[0]!.boards[0]!.localized!["de-DE"]![firstId]).toMatchObject({ content: expect.stringMatching(/^\[de\] /), origin: "auto" });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @chitrapx/document exec vitest run test/translations.test.ts && pnpm --filter @chitrapx/web exec vitest run test/followJob.test.ts`
Expected: FAIL. `textsIn` and `followJob` do not exist.

- [ ] **Step 3: Source texts and the worker**

In `packages/document/src/translations.ts`, add `import { allTexts, type SlotText } from "./ai.ts";` and append:

```ts
/** Every distinct text as `locale` reads it: that language's own text where it has one, the base text otherwise. */
export function textsIn(doc: ChitrapxDoc, locale: string): SlotText[] {
  const all = allTexts(doc);
  if (locale === doc.localization.baseLocale) return all;
  return all.map((t) => {
    const own = overrideOf(doc, locale, t.id)?.content;
    return own?.trim() ? { id: t.id, text: own } : t;
  });
}
```

In `apps/worker/src/ai/prompts.ts`, replace `translateSystem`. The text without a source is unchanged:

```ts
export function translateSystem(localeName: string, glossary: string[], sourceName?: string) {
  return `Translate App Store screenshot text${sourceName ? ` from ${sourceName}` : ""} into ${localeName}. Keep it as short and punchy as the source; a translation may be shorter but should not be much longer. Keep line breaks where the source has them. Keep these terms exactly as written, untranslated: ${glossary.length ? glossary.map((g) => JSON.stringify(g)).join(", ") : "(none)"}. Keep numbers, symbols and emoji. Return one translation for every id.`;
}
```

In `apps/worker/src/ai/jobs.ts`, add `textsIn` to the document import and replace `translateInput` and `runAiTranslate`:

```ts
const translateInput = z.object({
  locales: z.array(z.string().regex(LOCALE_CODE)).min(1).max(20),
  sourceLocale: z.string().regex(LOCALE_CODE).optional(),
  overwriteManual: z.boolean().optional(),
});
const localeName = (code: string) => { try { return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code; } catch { return code; } };

/** Machine-translates every text from the base or another language into each target, as automatic overrides. */
export async function runAiTranslate(raw: unknown, job: JobContext, deps: AiDeps) {
  const input = translateInput.safeParse(raw);
  if (!input.success) throw new FatalJobError("invalid_input");
  const { doc, app } = await projectDoc(job);
  const base = doc.localization.baseLocale;
  const from = input.data.sourceLocale && input.data.sourceLocale !== base ? input.data.sourceLocale : undefined;
  // A text the source language has not translated goes out in the base language.
  const texts = textsIn(doc, from ?? base).filter((t) => t.text.trim());
  if (!texts.length) throw new FatalJobError("nothing_to_translate");
  if (texts.reduce((n, t) => n + t.text.length, 0) > MAX_TEXT_CHARS) throw new FatalJobError("too_much_text");
  const glossary = [...new Set([app.name, ...app.glossary].filter(Boolean))];

  const usage: Usage[] = [];
  const results: Array<{ locale: string; texts: Array<{ id: string; text: string }> }> = [];
  for (const locale of input.data.locales) {
    if (locale === base || locale === from) continue;
    const { data, usage: u } = await deps.model.generate({
      model: MODELS.fast, system: translateSystem(localeName(locale), glossary, from && localeName(from)), schema: translationsSchema,
      content: [{ type: "text", text: translatePrompt(texts) }],
    });
    usage.push(u);
    const known = new Set(texts.map((t) => t.id));
    const usable = data.texts.filter((t) => known.has(t.id) && t.text.trim());
    if (usable.length < texts.length * MIN_COVERAGE) continue; // not charged; reported below
    results.push({ locale, texts: usable });
  }
  if (!results.length) throw new FatalJobError("ai_incomplete");
  // Applied to the latest document under the lock: edits made meanwhile are kept, and a slot whose source text
  // changed while translating is skipped rather than given a stale translation.
  const sources = new Map(texts.map((t) => [t.id, t.text]));
  await updateProjectDoc(job, (current) => results.reduce((d, r) =>
    applyTranslations(d, r.locale, r.texts, { sources, sourceLocale: from, overwriteManual: input.data.overwriteManual }), current));
  const skipped = input.data.locales.filter((l) => !results.some((r) => r.locale === l));
  return { actual: PRICES.ai_translate * results.length, output: { locales: results.map((r) => r.locale), skipped, usage: sumUsage(usage) } };
}
```

- [ ] **Step 4: Server**

In `apps/web/src/server/ai.ts`, replace `translateInput` and `startTranslate`:

```ts
const translateInput = z.object({
  locales: z.array(z.string().regex(LOCALE_CODE)).min(1).max(20),
  sourceLocale: z.string().regex(LOCALE_CODE).optional(),
  overwriteManual: z.boolean().optional(),
});
```

```ts
export async function startTranslate(ctx: Ctx, boss: PgBoss, projectId: string, raw: unknown) {
  const project = await getProject(ctx, projectId);
  const { locales, sourceLocale, overwriteManual } = translateInput.parse(raw ?? {});
  const loc = project.doc.localization;
  if (locales.includes(loc.baseLocale)) throw badRequest("base_locale");
  const source = sourceLocale && sourceLocale !== loc.baseLocale ? sourceLocale : undefined;
  if (source && !loc.locales.some((l) => l.code === source)) throw badRequest("unknown_source_locale");
  if (source && locales.includes(source)) throw badRequest("source_in_targets");
  if (!project.doc.groups.length) throw badRequest("project_is_empty");
  assertTextFits(project.doc);
  return enqueue(ctx, boss, project.id, "ai_translate", {
    locales: [...new Set(locales)], ...(source && { sourceLocale: source }), ...(overwriteManual && { overwriteManual: true }),
  });
}
```

- [ ] **Step 5: Following a job that rewrites the document**

`apps/web/src/lib/followJob.ts`:

```ts
import { api } from "@/server/api.ts";

export type FollowedJob = { id: string; status: string; error: string | null; output: unknown };

/** Follows one job (not a recent-jobs list) until it finishes, for as long as a job may run. */
export async function followJob(jobId: string, everyMs = 2000, tries = 330): Promise<FollowedJob> {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, everyMs));
    const job = await api<FollowedJob>(`/api/jobs/${jobId}`);
    if (job.status === "done" || job.status === "failed") return job;
  }
  throw new Error("This is taking longer than expected. Check back in a minute.");
}
```

`apps/web/src/editor/docJobs.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext } from "react";
import { migrate, type ChitrapxDoc } from "@chitrapx/document";
import { jobError } from "@/components/jobText.ts";
import { followJob, type FollowedJob } from "@/lib/followJob.ts";
import { api } from "@/server/api.ts";
import { useEditorStore } from "./context.tsx";

type Run = (start: () => Promise<{ jobId: string }>) => Promise<FollowedJob>;
const Ctx = createContext<Run | null>(null);

/**
 * AI jobs that rewrite the saved document (translate, regenerate chips): save first, keep the editor read-only
 * while the job runs so nothing can conflict with it, then load the saved result. Loading clears undo history,
 * as a version restore does.
 */
export function DocJobProvider({ flush, adoptServerDoc, children }: {
  flush: () => Promise<boolean>; adoptServerDoc: (doc: ChitrapxDoc, revision: number) => void; children: React.ReactNode;
}) {
  const store = useEditorStore();
  const run = useCallback<Run>(async (start) => {
    if (!(await flush())) throw new Error("Your latest changes are not saved yet. Check your connection and try again.");
    store.getState().setLocked(true);
    try {
      const job = await followJob((await start()).jobId);
      if (job.status === "failed") throw new Error(jobError(job.error));
      const project = await api<{ doc: unknown; revision: number }>(`/api/projects/${store.getState().projectId}`);
      adoptServerDoc(migrate(project.doc), project.revision);
      return job;
    } finally {
      store.getState().setLocked(false);
    }
  }, [flush, adoptServerDoc, store]);
  return <Ctx.Provider value={run}>{children}</Ctx.Provider>;
}

export function useDocJob(): Run {
  const run = useContext(Ctx);
  if (!run) throw new Error("useDocJob outside DocJobProvider");
  return run;
}
```

In `apps/web/src/editor/Editor.tsx`:
- Add `import { DocJobProvider } from "./docJobs.tsx";` and a `glossary: string[]` prop.
- Wrap the `<div className="flex h-screen flex-col">…</div>` in `<DocJobProvider flush={flush} adoptServerDoc={adoptServerDoc}>…</DocJobProvider>`.
- Pass `glossary={glossary}` to `<Toolbar>`.

In `apps/web/src/editor/ui/Toolbar.tsx`, add `glossary: string[]` to the props and render `<TranslationsTable name={name} glossary={glossary} onClose={() => setTranslating(false)} />`. In `apps/web/src/app/editor/[projectId]/page.tsx`, pass `glossary={app.glossary}` to `<Editor>`.

- [ ] **Step 6: AI section and glossary in the table**

In `apps/web/src/editor/ui/TranslationsTable.tsx`, add these imports:

```tsx
import { api } from "@/server/api.ts";
import { useEditorAssets } from "../assets.tsx";
import { useDocJob } from "../docJobs.tsx";
```

Add these two components above `TranslationsTable`:

```tsx
/** Machine translation into chosen languages from the base or any other column. 2 credits per language that comes back. */
function AiTranslate() {
  const run = useDocJob();
  const projectId = useEditor((s) => s.projectId);
  const loc = useEditor((s) => s.doc.localization);
  const locked = useEditor((s) => s.locked);
  const [source, setSource] = useState(loc.baseLocale);
  const [targets, setTargets] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const options = loc.locales.map((l) => l.code).filter((c) => c !== source);
  const chosen = targets.filter((t) => options.includes(t));

  async function translate() {
    setBusy(true);
    setMessage("");
    try {
      const job = await run(() => api<{ jobId: string }>(`/api/projects/${projectId}/translate`, "POST",
        { locales: chosen, sourceLocale: source, ...(overwrite && { overwriteManual: true }) }));
      const out = job.output as { locales?: string[]; skipped?: string[] } | null;
      setMessage(`Translated ${out?.locales?.join(", ") || "nothing"}.${out?.skipped?.length ? ` Not translated, not charged: ${out.skipped.join(", ")}.` : ""}`);
      setTargets([]);
    } catch (err) { setMessage((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <section className="flex flex-wrap items-end gap-3 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800" aria-label="AI translation">
      <div>
        <label className="label" htmlFor="tr-source">Translate from</label>
        <select id="tr-source" className="input py-1 text-xs" value={source} onChange={(e) => setSource(e.target.value)}>
          {[loc.baseLocale, ...loc.locales.map((l) => l.code)].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="label">Into</legend>
        {options.map((c) => (
          <label key={c} className="flex items-center gap-1">
            <input type="checkbox" checked={chosen.includes(c)} onChange={(e) => setTargets((t) => (e.target.checked ? [...t, c] : t.filter((x) => x !== c)))} /> {c}
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-1" title="Off: cells written by hand are kept">
        <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> Overwrite hand-written translations
      </label>
      <button type="button" className="btn px-2 py-1" disabled={!chosen.length || busy || locked} onClick={translate}>
        {busy ? "Translating" : `Translate (${chosen.length * 2} credits)`}
      </button>
      {message && <p role="status" className="w-full">{message}</p>}
    </section>
  );
}

/** Terms AI translation keeps exactly as written; saved on the app. */
function Glossary({ initial }: { initial: string[] }) {
  const { appId } = useEditorAssets();
  const [terms, setTerms] = useState(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  async function save(next: string[]) {
    setError("");
    try { setTerms((await api<{ glossary: string[] }>(`/api/apps/${appId}`, "PATCH", { glossary: next })).glossary); }
    catch (err) { setError((err as Error).message); }
  }
  return (
    <section className="flex flex-wrap items-center gap-1 text-xs" aria-label="Glossary">
      <span className="label">Do not translate:</span>
      {terms.map((t) => (
        <span key={t} className="inline-flex items-center rounded bg-neutral-100 px-1.5 dark:bg-neutral-800">
          {t}<button type="button" aria-label={`Remove ${t}`} className="ml-1 text-neutral-500 hover:text-red-600" onClick={() => save(terms.filter((x) => x !== t))}>x</button>
        </span>
      ))}
      <input className="input w-36 py-0.5 text-xs" placeholder="Add a term" value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { void save([...terms, draft.trim()]); setDraft(""); } }} />
      <span className="text-neutral-500">The app name is always kept.</span>
      {error && <span role="alert" className="error">{error}</span>}
    </section>
  );
}
```

Change the `TranslationsTable` signature to `export function TranslationsTable({ name, glossary, onClose }: { name: string; glossary: string[]; onClose: () => void })`, and render `<AiTranslate />` and `<Glossary initial={glossary} />` right after the `</header>`.

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/web exec vitest run test/followJob.test.ts test/ai.test.ts && pnpm --filter @chitrapx/worker exec vitest run test/ai.test.ts`
Expected: PASS.

- [ ] **Step 8: Browser check (needs `ANTHROPIC_API_KEY` in `.env` and the worker running: `pnpm --filter @chitrapx/worker dev`)**

Start the web dev server with the dev-server commands in Global Constraints. Open a project with `fr-FR` filled in, and `ar-SA` and `de-DE` added, with one Arabic cell typed by hand.
- In the table, choose "Translate from fr-FR", tick `ar-SA` and `de-DE`, and click "Translate (4 credits)". The table is read-only while it runs, then both columns fill and the hand-typed Arabic cell is unchanged. The credit ledger on the dashboard shows 4 credits spent (2 per language).
- Add "Pour-over Pro" to "Do not translate" and translate `de-DE` again: the term comes back unchanged.
- Tick "Overwrite hand-written translations" and translate `ar-SA`: the hand-typed cell is replaced and its border turns neutral.

Stop the server and the worker by PID.

- [ ] **Step 9: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: the only error is `billing.ts:61`.

```bash
git add packages/document apps/web apps/worker
git commit -m "feat(ai): translate from any language, keep or overwrite hand-edited cells, per-app glossary"
```

---

### Task 8: Mirrored layout and script leading in the projection

**Files:**
- Modify: `packages/document/src/artboard.ts` (`ProjectLocalization.mirrorRtl`), `packages/document/src/doc.ts` (`localization` schema), `packages/renderer/src/osg/i18n/project.ts` (`mirrorsLocale`, `mirrorElement`, leading, `projectArtboards`, `unprojectArtboards`), `packages/renderer/src/index.ts`
- Test: `packages/renderer/test/rtl.test.tsx` (create), `packages/document/test/sp11-schema.test.ts` (create)

**Interfaces:**
- Produces:
  - `ProjectLocalization.mirrorRtl?: boolean`
  - from `@chitrapx/renderer`: `mirrorsLocale(localization: { mirrorRtl?: boolean } | undefined, locale: string | null): boolean`
  - `mirrorElement(el, boardWidth): ArtboardElement` (renderer-internal, exported from `project.ts`)
- Behaviour:
  - In a mirrored locale, every board element's x is reflected across the board's centre (scale included) and its rotation negated. An element whose `position` is detached for that language is left where it is. Span elements are untouched (`boardFor` adds them after projection).
  - Urdu text gets a line height of at least 1.8, Arabic and Persian at least 1.3, when the language has its own content and `lineHeight` is not detached.

- [ ] **Step 1: Failing tests**

`packages/renderer/test/rtl.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArtboardElement, ArtboardState, ChitrapxDoc, TextElementProps } from "@chitrapx/document";
import { boardFor } from "../src/board.ts";
import { fontUsesOf, googleFontsHref } from "../src/fonts.tsx";
import { TextElement } from "../src/osg/elements/TextElement";
import { mirrorsLocale, projectArtboards, unprojectArtboards } from "../src/osg/i18n/project";

const text = (id: string, x: number, extra: Partial<TextElementProps> = {}) => ({ id, type: "text", content: "Track habits", fontSize: 30, color: "#111111", fontFamily: "Inter",
  textAlign: "left", lineHeight: 1.1, position: { x, y: 100 }, size: { width: 400, height: 200 }, rotation: 0, scale: 1, ...extra }) as TextElementProps;
const device = { id: "d", type: "device", deviceType: "iphone-15", position: { x: 40, y: 400 }, size: { width: 500, height: 1000 }, rotation: 8, scale: 1 } as unknown as ArtboardElement;
const loc = (mirrorRtl?: boolean) => ({
  baseLocale: "en-US", locales: [{ code: "ar-SA", autoFit: false }, { code: "de-DE", autoFit: false }, { code: "he", autoFit: false }], ...(mirrorRtl ? { mirrorRtl } : {}),
});
const board = (mirrorRtl?: boolean, localized?: ArtboardState["localized"]): ArtboardState => ({
  id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1,
  elements: [device, text("t", 800)], localization: loc(mirrorRtl), ...(localized ? { localized } : {}),
});
const at = (b: ArtboardState, id: string) => b.elements.find((e) => e.id === id)!;

describe("mirrored layout (SP11)", () => {
  it("only an RTL language of a project that opted in is mirrored; the rest come back by reference", () => {
    const on = [board(true)];
    expect(projectArtboards(on, "en-US")).toBe(on);
    expect(projectArtboards(on, "de-DE")).toBe(on);
    const off = [board()];
    expect(projectArtboards(off, "ar-SA")).toBe(off);
    expect(mirrorsLocale(on[0]!.localization, "ar-SA")).toBe(true);
    expect(mirrorsLocale(on[0]!.localization, "de-DE")).toBe(false);
    expect(mirrorsLocale(off[0]!.localization, "ar-SA")).toBe(false);
  });

  it("swaps a device on the left and text on the right, and tilts the other way", () => {
    const [b] = projectArtboards([board(true)], "ar-SA");
    expect(at(b!, "d").position).toEqual({ x: 1290 - 40 - 500, y: 400 });
    expect(at(b!, "d").rotation).toBe(-8);
    expect(at(b!, "t").position).toEqual({ x: 1290 - 800 - 400, y: 100 });
    expect(at(b!, "t").rotation).toBe(0);
    expect(at(projectArtboards([board(true)], "he")[0]!, "d").position.x).toBe(750);
  });

  it("counts the element's scale, and leaves a position this language holds itself alone", () => {
    const scaled = { ...board(true), elements: [{ ...device, scale: 0.5 }] } as ArtboardState;
    expect(projectArtboards([scaled], "ar-SA")[0]!.elements[0]!.position.x).toBe(1290 - 40 - 250);
    const held = board(true, { "ar-SA": { d: { position: { x: 10, y: 20 }, detached: ["position"] } } });
    expect(at(projectArtboards([held], "ar-SA")[0]!, "d").position).toEqual({ x: 10, y: 20 });
  });

  it("a mirrored view is never written back into the base", () => {
    const base = [board(true)];
    expect(unprojectArtboards(base, "ar-SA", projectArtboards(base, "ar-SA"))).toBe(base);
  });

  it("boardFor mirrors exports and previews too", () => {
    const d = { schemaVersion: 1, kind: "screenshots", localization: loc(true),
      groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards: [{ ...board(), localization: undefined }] }] } as unknown as ChitrapxDoc;
    expect(boardFor(d, "g", 0, "ar-SA", (s) => s).board.elements.find((e) => e.id === "d")!.position.x).toBe(750);
    expect(boardFor(d, "g", 0, "en-US", (s) => s).board.elements.find((e) => e.id === "d")!.position.x).toBe(40);
  });
});

describe("scripts (SP11)", () => {
  const withText = (code: string, content: string, ov: Record<string, unknown> = {}) => {
    const b = { ...board(), localization: { baseLocale: "en-US", locales: [{ code, autoFit: false }] }, localized: { [code]: { t: { content, ...ov } } } } as ArtboardState;
    return at(projectArtboards([b], code)[0]!, "t") as TextElementProps;
  };

  it("Arabic and Hebrew text gets a face with the glyphs, and the board stylesheet asks for it", () => {
    const ar = withText("ar-SA", "هل أنت مستعد؟");
    expect(ar.fontFamily).toBe("Noto Sans Arabic");
    expect(withText("he", "מוכנים?").fontFamily).toBe("Noto Sans Hebrew");
    expect(googleFontsHref(fontUsesOf([{ ...board(), elements: [ar] }]))).toContain("family=Noto+Sans+Arabic");
  });

  it("Arabic and Urdu get more leading than Latin; a detached line height wins; other languages are untouched", () => {
    expect(withText("ar-SA", "مرحبا").lineHeight).toBe(1.3);
    expect(withText("ur", "خوش آمدید").lineHeight).toBe(1.8);
    expect(withText("ar-SA", "مرحبا", { lineHeight: 1.05, detached: ["lineHeight"] }).lineHeight).toBe(1.05);
    expect(withText("de-DE", "Hallo").lineHeight).toBe(1.1);
  });

  it("text takes its direction from its content and aligns to the side it starts on", () => {
    const html = renderToStaticMarkup(<TextElement element={text("t", 0, { content: "هل أنت مستعد لـ Bloom؟ 2026" })} onUpdate={() => {}} isSelected={false} artboardZoom={1} />);
    expect(html).toContain('dir="auto"');
    expect(html).toContain("text-align:start");
    expect(html).toContain("justify-content:flex-start");
  });
});
```

`packages/document/test/sp11-schema.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/index.ts";
import { board, doc, group, text } from "./fixtures.ts";

describe("SP11 document fields", () => {
  it("documents saved before SP11 pass migrate unchanged, templates included", () => {
    const d = doc([group([board("b1", [text("t", 0, 0)])])]);
    expect(migrate(d)).toEqual(d);
    const dir = join(import.meta.dirname, "../../assets/templates");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && !x.startsWith("_"))) {
      const once = migrate(JSON.parse(readFileSync(join(dir, f), "utf8")).doc);
      expect(migrate(once), f).toEqual(once);
    }
  });

  it("keeps mirrorRtl and refuses anything but a boolean", () => {
    const d = doc([group([board("b1", [])])]);
    d.localization = { baseLocale: "en-US", locales: [{ code: "ar-SA" }], mirrorRtl: true };
    expect(migrate(d).localization.mirrorRtl).toBe(true);
    expect(() => migrate({ ...d, localization: { ...d.localization, mirrorRtl: "yes" } })).toThrow();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @chitrapx/renderer exec vitest run test/rtl.test.tsx`
Expected: FAIL. `mirrorsLocale` is not exported.

- [ ] **Step 3: Document**

In `packages/document/src/artboard.ts`, add to `ProjectLocalization` after `locales`:

```ts
  /**
   * SP11: mirror element positions in right-to-left languages (Arabic, Hebrew, Persian, Urdu). Derived at
   * projection time and never stored per element; a position detached for a language is left alone.
   */
  mirrorRtl?: boolean;
```

In `packages/document/src/doc.ts`, change the `localization` object to:

```ts
const localization = z.object({
  baseLocale: z.string().regex(LOCALE_CODE).default(DEFAULT_BASE_LOCALE),
  locales: z.array(z.object({ code: z.string().regex(LOCALE_CODE) }).passthrough()).default([]),
  mirrorRtl: z.boolean().optional(),
}).passthrough().refine((l) => {
  const codes = [l.baseLocale, ...l.locales.map((x) => x.code)];
  return new Set(codes).size === codes.length;
}, { message: "Each language may appear once" });
```

- [ ] **Step 4: Projection**

In `packages/renderer/src/osg/i18n/project.ts`, after `autoFamilyFor`, add:

```ts
// --- right-to-left -------------------------------------------------------------

/**
 * SP11: scripts that need more room between lines than Latin at the same size. Derived like the auto-shrink
 * and only where the language has its own text, so a later change to the base line height still reaches it.
 */
const MIN_LINE_HEIGHT: Record<string, number> = { ur: 1.8, ar: 1.3, fa: 1.3 };

function minLineHeightFor(entry: LocaleEntry | undefined): number | undefined {
  if (!entry) return undefined;
  const lang = (getLocaleDef(entry.code)?.translateCode || entry.code).split('-')[0]!;
  return MIN_LINE_HEIGHT[lang];
}

/** True when `locale` shows the boards mirrored: the project opted in and the language reads right to left. */
export function mirrorsLocale(localization: { mirrorRtl?: boolean } | undefined, locale: string | null): boolean {
  return !!locale && !!localization?.mirrorRtl && !!getLocaleDef(locale)?.rtl;
}

/** The element reflected across the board's vertical centre line; its tilt flips with it. Content is never flipped. */
export function mirrorElement(el: ArtboardElement, boardWidth: number): ArtboardElement {
  const width = el.size.width * (el.scale || 1);
  return { ...el, position: { x: boardWidth - el.position.x - width, y: el.position.y }, rotation: el.rotation ? -el.rotation : el.rotation } as ArtboardElement;
}
```

In `resolveElementForLocale`, between the `fontFamily` block and the `autoFit` block, add:

```ts
  // SP11: Arabic and Urdu need more leading than Latin at the same size. A detached line height is the user's choice.
  if (ov.content !== undefined && !isDetached(ov, 'lineHeight')) {
    const min = minLineHeightFor(entry);
    const current = (next as TextElementProps).lineHeight ?? 1.2;
    if (min && current < min) assign('lineHeight', min);
  }
```

Replace `projectArtboards` with:

```ts
export function projectArtboards(base: ArtboardState[], locale: string | null): ArtboardState[] {
  if (!locale) return base;
  const localization = getLocalization(base);
  if (!localization) return base;
  if (locale === (localization.baseLocale || DEFAULT_BASE_LOCALE)) return base;
  const entry = (localization.locales || []).find((candidate) => candidate?.code === locale);
  if (!entry) return base;
  const mirror = mirrorsLocale(localization, locale);

  let changed = false;
  const projected = base.map((board) => {
    const overrides = board.localized?.[locale];
    if (!overrides && !mirror) return board;

    let boardChanged = false;
    const elements: ArtboardElement[] = [];
    for (const el of board.elements) {
      const ov = overrides?.[el.id];
      // Hidden is expressed by absence, so every renderer gets it for free and
      // none of them needs to learn the word "locale". unprojectArtboards reads
      // the same absence back as hidden, never as a delete.
      if (ov?.hidden) {
        boardChanged = true;
        continue;
      }
      let resolved = resolveElementForLocale(el, ov, entry);
      // A position this language holds itself is where the user put it: never mirrored again.
      if (mirror && !isDetached(ov, 'position')) resolved = mirrorElement(resolved, board.size.width);
      if (resolved !== el) boardChanged = true;
      elements.push(resolved);
    }
    if (!boardChanged) return board;
    changed = true;
    return { ...board, elements };
  });

  return changed ? projected : base;
}
```

In `unprojectArtboards`, right after the `if (!entry) return view;` line, add:

```ts
  // A mirrored view holds reflected positions; writing them back would move every language. Mirrored views are preview-only.
  if (mirrorsLocale(localization, locale)) {
    devError('a mirrored locale view is preview-only, dropping the commit', { locale });
    return base;
  }
```

Append to `packages/renderer/src/index.ts`:

```ts
export { mirrorsLocale } from "./osg/i18n/project";
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @chitrapx/renderer test && pnpm --filter @chitrapx/document test`
Expected: PASS, the SP10 `textMarks.test.tsx` included.

- [ ] **Step 6: Commit**

```bash
git add packages/document packages/renderer
git commit -m "feat(renderer): opt-in mirrored layout for right-to-left languages and script leading"
```

---

### Task 9: RTL in the editor, and Arabic and Hebrew goldens

**Files:**
- Modify: `apps/web/src/editor/commands.ts` (`setMirrorRtl`), `apps/web/src/editor/ui/Toolbar.tsx` (RTL badges, mirror checkbox), `apps/web/src/editor/ui/Canvas.tsx` (preview-only when mirrored)
- Modify: `apps/worker/test-e2e/export.test.ts` (top-level `localePng` helper, RTL goldens)
- Create (generated): `packages/assets/golden/rtl-ar.png`, `rtl-ar-mirrored.png`, `rtl-he.png`
- Test: `apps/web/test/commands.test.ts` (append)

**Interfaces:**
- Produces: the command `{ type: "setMirrorRtl"; on: boolean }`, and `localePng(ws, appId, doc, locale)` (e2e helper, reused in Task 11).
- Consumes: `mirrorsLocale` (Task 8), `LOCALES` (renderer).

- [ ] **Step 1: Failing test**

Append to `apps/web/test/commands.test.ts`:

```ts
describe("RTL (SP11)", () => {
  it("setMirrorRtl turns mirroring on and off, and repeating either is no step", () => {
    const on = applyCommand(doc(), { type: "setMirrorRtl", on: true });
    expect(on.localization.mirrorRtl).toBe(true);
    expect(applyCommand(on, { type: "setMirrorRtl", on: true })).toBe(on);
    const off = applyCommand(on, { type: "setMirrorRtl", on: false });
    expect(off.localization).not.toHaveProperty("mirrorRtl");
    expect(applyCommand(off, { type: "setMirrorRtl", on: false })).toBe(off);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @chitrapx/web exec vitest run test/commands.test.ts`
Expected: FAIL. The command is unknown, so the document is unchanged.

- [ ] **Step 3: Command, toolbar, canvas**

In `apps/web/src/editor/commands.ts`, add `| { type: "setMirrorRtl"; on: boolean }` to `Command`, and in the `switch`, next to `addLocale`:

```ts
      case "setMirrorRtl":
        if (cmd.on) d.localization.mirrorRtl = true;
        else delete d.localization.mirrorRtl;
        return;
```

In `apps/web/src/editor/ui/Toolbar.tsx`, after `const codes = …`, add `const rtl = (c: string) => !!LOCALES.find((l) => l.code === c)?.rtl;`. Replace the language button with:

```tsx
            <button type="button" className={c === locale ? "btn px-2 py-1 text-xs" : "btn-ghost px-2 py-1 text-xs"} onClick={() => store.getState().setLocale(c)}>
              {c}{rtl(c) && <span className="ml-1 rounded bg-neutral-200 px-1 text-[9px] font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200" title="Right-to-left">RTL</span>}
            </button>
```

and after the "Add language" `<select>`, still inside the `<nav>`:

```tsx
        {codes.some(rtl) && (
          <label className="flex items-center gap-1 text-xs" title="Positions mirror in Arabic, Hebrew, Persian and Urdu. Check every board in those languages before exporting.">
            <input type="checkbox" checked={!!loc.mirrorRtl} onChange={(e) => store.getState().apply({ type: "setMirrorRtl", on: e.target.checked })} />
            Mirror layout in RTL languages
          </label>
        )}
```

In `apps/web/src/editor/ui/Canvas.tsx`, change the renderer import to `import { BoardView, mirrorsLocale } from "@chitrapx/renderer";`. After `const single = …`, add:

```tsx
  /** The hit boxes are drawn from base positions; in a mirrored view they would sit on the wrong side, so the view is preview-only. */
  const mirrored = mirrorsLocale(doc.localization, locale);
```

Wrap the hit boxes and handles so they are not drawn when mirrored: change `{hittable.map(({ ref, el, offset }) => {` to `{!mirrored && hittable.map(({ ref, el, offset }) => {`, and `{single && (() => {` to `{!mirrored && single && (() => {`. Directly inside the `<div className="p-8" …>`, before the relative strip, add:

```tsx
        {mirrored && (
          <p role="status" className="mb-2 inline-block rounded bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
            Mirrored preview for {locale}. Switch to {doc.localization.baseLocale} to move or resize things; text and properties still edit here.
          </p>
        )}
```

- [ ] **Step 4: Goldens**

In `apps/worker/test-e2e/export.test.ts`, after `singleBoardPng`, add:

```ts
/** Board 0 of `doc` in `locale` as a single PNG. */
async function localePng(ws: string, appId: string, doc: ChitrapxDoc, locale: string) {
  const g = doc.groups[0]!;
  const id = await newProject(ws, appId, doc);
  const j = await pinnedExport(ws, id, { targets: [g.target], locales: [locale], board: { groupId: g.id, boardIndex: 0 } }, "export_single");
  await runJob(j, (input, job) => runExport(input, job, "single"));
  expect((await jobRow(j)).status).toBe("done");
  return storage().download(`${ws}/${j}.png`, EXPORTS_BUCKET);
}
```

and append:

```ts
describe("right-to-left (SP11)", () => {
  /** amoura's first headline written in `locale`. */
  async function translated(locale: string, content: string, mirrorRtl: boolean, autoFont = true) {
    const doc = await templateDoc("amoura-dating");
    doc.localization = { baseLocale: "en-US", locales: [{ code: locale, ...(autoFont ? {} : { autoFont: false }) }], ...(mirrorRtl ? { mirrorRtl } : {}) };
    const b0 = doc.groups[0]!.boards[0]!;
    const id = b0.elements.find((e) => e.type === "text")!.id;
    b0.localized = { [locale]: { [id]: { content } } };
    return migrate(doc);
  }
  // A trailing question mark, digits and a Latin brand name inside Arabic text.
  const AR = "هل أنت مستعد لـ Bloom؟ 2026";

  it("Arabic renders in the Arabic face, mirrored only when the project asks", async () => {
    const { ws, appId } = await workspaceWithApp();
    const plain = await localePng(ws, appId, await translated("ar-SA", AR, false), "ar-SA");
    const mirrored = await localePng(ws, appId, await translated("ar-SA", AR, true), "ar-SA");
    compareGolden("rtl-ar.png", plain);
    compareGolden("rtl-ar-mirrored.png", mirrored);
    const a = PNG.sync.read(plain), b = PNG.sync.read(mirrored);
    expect(pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 })).toBeGreaterThan(5000);
    // Without the substituted face the browser falls back to whatever it has, so the glyphs must differ.
    const fallback = PNG.sync.read(await localePng(ws, appId, await translated("ar-SA", AR, false, false), "ar-SA"));
    expect(pixelmatch(a.data, fallback.data, null, a.width, a.height, { threshold: 0.1 })).toBeGreaterThan(500);
  }, 300_000);

  it("the base language of a mirrored project is pixel-identical", async () => {
    const { ws, appId } = await workspaceWithApp();
    const on = PNG.sync.read(await localePng(ws, appId, await translated("ar-SA", AR, true), "en-US"));
    const off = PNG.sync.read(await localePng(ws, appId, await translated("ar-SA", AR, false), "en-US"));
    expect(pixelmatch(on.data, off.data, null, on.width, on.height, { threshold: 0.1 })).toBe(0);
  }, 240_000);

  it("Hebrew matches its golden", async () => {
    const { ws, appId } = await workspaceWithApp();
    compareGolden("rtl-he.png", await localePng(ws, appId, await translated("he", "מוכנים ל-Bloom? 2026", false), "he"));
  }, 180_000);
});
```

- [ ] **Step 5: Run the unit tests, then the e2e suite**

Run: `pnpm --filter @chitrapx/web exec vitest run test/commands.test.ts`
Expected: PASS.

Then, with the dev-server commands in Global Constraints, run `pnpm --filter @chitrapx/worker test:e2e`.
Expected: PASS. The three new goldens are written on this first run. Open them and check:
- `rtl-ar.png` has the Arabic headline in the template's headline box, aligned right, with "؟" at its left end, "Bloom" readable, and no boxes.
- `rtl-ar-mirrored.png` has the phone and the text swapped left to right.
- `rtl-he.png` has Hebrew right-aligned, with the question mark at the left end.

Run the e2e suite again. Expected: PASS, with every golden matching.

- [ ] **Step 6: Browser check**

Start the web dev server with the dev-server commands in Global Constraints.
- Add Arabic (`ar-SA`) in the editor: the button shows `RTL`, and "Mirror layout in RTL languages" appears.
- Tick it and switch to `ar-SA`: the boards mirror, the handles disappear and the amber note shows. Switch back to `en-US`: nothing moved, and the handles are back.
- Untick it: `ar-SA` is no longer mirrored. Undo restores the tick in one step.

Stop the server by PID.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: the only error is `billing.ts:61`.

```bash
git add apps/web apps/worker/test-e2e packages/assets/golden
git commit -m "feat(editor): mirror toggle and RTL badges, preview-only canvas for mirrored languages, Arabic and Hebrew goldens"
```

---

### Task 10: The chips element in the document

**Files:**
- Create: `packages/document/src/chips.ts`
- Modify:
  - `packages/document/src/artboard.ts` (`ElementType`, `ChipsElementProps`, `ArtboardElement`, `ElementLocaleOverride.chips`)
  - `packages/document/src/doc.ts` (type enum, chips normalisation)
  - `packages/document/src/ai.ts` (`allTexts`, `applyTexts`, `applyTranslations`)
  - `packages/document/src/translations.ts` (chip rows, cells, writes, `textsIn`)
  - `packages/document/src/retarget.ts`, `packages/document/src/index.ts`
- Test: `packages/document/test/chips.test.ts` (create)

**Interfaces:**
- Produces:
  - `ChipsElementProps = BaseElement & { type: 'chips'; chips: string[]; fontSize: number; fontFamily: string; fontWeight?: string; color: string; fillColor: string; align?: 'left' | 'center' | 'right'; gap?: number }`
  - `ElementLocaleOverride.chips?: string[]`
  - Limits: `CHIP_MAX = 6`, `CHIP_MIN = 4`, `CHIP_MAX_CHARS = 24`, `CHIP_BUDGET = 16`
  - `normalizeChips(raw): string[]`, `normalizeChipOverride(raw, baseLength): string[] | undefined`, `aiChips(raw): string[]`
  - `chipId(elementId, index)`, `parseChipId(id)`, `chipsSource(chips)`, `isChips(el)`, `hasChips(doc)`
  - `remapChipOverride(list, from): string[] | undefined`, where `from[i]` is the old index of new chip i, or -1
  - `applyChips(doc, chips): ChitrapxDoc`
  - `TranslationRow.chip?: number`
- `allTexts` emits `<id>#<n>` per chip. `applyTexts`, `applyTranslations`, `writeTranslations`, `cellFor` and `textsIn` understand them.

- [ ] **Step 1: Failing tests**

`packages/document/test/chips.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  aiChips, allTexts, applyChips, applyTexts, applyTranslations, cellFor, chipId, hash32, hasChips, migrate, normalizeChipOverride, normalizeChips,
  parseChipId, remapChipOverride, retarget, textsIn, translationRows, writeTranslations, type ChitrapxDoc,
} from "../src/index.ts";
import { board, doc, group, text } from "./fixtures.ts";

const chips = (list: string[]) => ({ id: "c", type: "chips", name: "Chips", chips: list, fontSize: 6, fontFamily: "Inter", fontWeight: "600",
  color: "#ffffff", fillColor: "#4f46e5", position: { x: 0, y: 0 }, size: { width: 480, height: 96 }, rotation: 0, scale: 1 }) as never;
function project(): ChitrapxDoc {
  const d = doc([{ ...group([board("fb", [{ ...text("h", 0, 0), content: "Track habits" } as never, chips(["Fast", "Private", "Offline"])], 1024, 500)]), target: "play-feature" }]);
  d.localization.locales = [{ code: "de-DE" }];
  return d;
}
const chipsOf = (d: ChitrapxDoc) => (d.groups[0]!.boards[0]!.elements.find((e) => e.type === "chips") as unknown as { chips: string[] }).chips;
const ovOf = (d: ChitrapxDoc) => d.groups[0]!.boards[0]!.localized?.["de-DE"]?.c;

describe("chip lists", () => {
  it("normalise: trimmed, capped at 24 characters, no blanks or repeats, at most six", () => {
    expect(normalizeChips(["  Fast  ", "fast", "", "x".repeat(30), "A", "B", "C", "D", "E"])).toEqual(["Fast", "x".repeat(24), "A", "B", "C", "D"]);
    expect(normalizeChips("nope")).toEqual([]);
  });

  it("a language's list keeps blanks as 'use the base chip', is cut to the base length and dropped when empty", () => {
    expect(normalizeChipOverride(["Schnell", "", "Offline", "Extra"], 3)).toEqual(["Schnell", "", "Offline"]);
    expect(normalizeChipOverride(["Schnell", "", ""], 3)).toEqual(["Schnell"]);
    expect(normalizeChipOverride(["", " "], 3)).toBeUndefined();
  });

  it("AI chips are held to two words and 16 characters", () => {
    expect(aiChips(["Brew timer", "Recipes", "Recipes", "A very long feature name", "Three word chip", 4, "Bean log"])).toEqual(["Brew timer", "Recipes", "Bean log"]);
  });

  it("chip ids round-trip, and a reorder carries each language's words", () => {
    expect(parseChipId(chipId("el-1", 3))).toEqual({ elementId: "el-1", index: 3 });
    expect(parseChipId("headline")).toBeNull();
    expect(remapChipOverride(["Schnell", "Privat", ""], [2, 0])).toEqual(["", "Schnell"]);
    expect(remapChipOverride(["Schnell", "Privat"], [0, 1, -1])).toEqual(["Schnell", "Privat"]);
    expect(remapChipOverride(undefined, [0])).toBeUndefined();
  });
});

describe("chips in the document", () => {
  it("migrate normalises the base list and each language's list", () => {
    const d = project();
    (d.groups[0]!.boards[0]!.elements[1] as unknown as { chips: string[] }).chips = [" Fast ", "fast", "Private"];
    d.groups[0]!.boards[0]!.localized = { "de-DE": { c: { chips: ["Schnell", "", "zu viel", "noch mehr"] } } };
    const out = migrate(d);
    expect(chipsOf(out)).toEqual(["Fast", "Private"]);
    expect(ovOf(out)!.chips).toEqual(["Schnell"]);
    expect(hasChips(out)).toBe(true);
  });

  it("chips are texts for AI copy and translation, one id per chip", () => {
    expect(allTexts(project())).toEqual([{ id: "h", text: "Track habits" }, { id: "c#0", text: "Fast" }, { id: "c#1", text: "Private" }, { id: "c#2", text: "Offline" }]);
    expect(chipsOf(applyTexts(project(), [{ id: "c#1", text: "Encrypted" }]))).toEqual(["Fast", "Encrypted", "Offline"]);
  });

  it("machine translation writes an automatic list hashed against the base list, and keeps a hand-written one", () => {
    const out = applyTranslations(project(), "de-DE", [{ id: "c#0", text: "Schnell" }, { id: "c#2", text: "Offline-Modus" }]);
    expect(ovOf(out)).toEqual({ chips: ["Schnell", "", "Offline-Modus"], origin: "auto", sourceHash: hash32("Fast\nPrivate\nOffline") });
    const manual = project();
    manual.groups[0]!.boards[0]!.localized = { "de-DE": { c: { chips: ["Flott"], origin: "manual" } } };
    expect(ovOf(applyTranslations(manual, "de-DE", [{ id: "c#0", text: "Schnell" }]))!.chips).toEqual(["Flott"]);
    expect(ovOf(applyTranslations(manual, "de-DE", [{ id: "c#0", text: "Schnell" }], { overwriteManual: true }))!.chips).toEqual(["Schnell"]);
  });

  it("the table has one row per chip, and a typed chip is a manual list entry", () => {
    expect(translationRows(project()).map((r) => [r.id, r.label, r.base])).toEqual([
      ["h", "h", "Track habits"], ["c#0", "Chips 1", "Fast"], ["c#1", "Chips 2", "Private"], ["c#2", "Chips 3", "Offline"],
    ]);
    const out = writeTranslations(project(), [{ locale: "de-DE", id: "c#1", text: "Privat" }]);
    expect(ovOf(out)).toEqual({ chips: ["", "Privat"], origin: "manual", sourceHash: hash32("Fast\nPrivate\nOffline") });
    expect(cellFor(out, translationRows(out)[2]!, "de-DE")).toEqual({ text: "Privat", state: "manual" });
    expect(cellFor(out, translationRows(out)[1]!, "de-DE").state).toBe("untranslated");
    expect(textsIn(out, "de-DE").find((t) => t.id === "c#1")!.text).toBe("Privat");
    expect(ovOf(writeTranslations(out, [{ locale: "de-DE", id: "c#1", text: "" }]))).toBeUndefined();
  });

  it("new chips everywhere drop the old chips' translations", () => {
    const d = applyTranslations(project(), "de-DE", [{ id: "c#0", text: "Schnell" }]);
    const out = applyChips(d, ["Brew timer", "Recipes", "Bean log", "Grind guide"]);
    expect(chipsOf(out)).toEqual(["Brew timer", "Recipes", "Bean log", "Grind guide"]);
    expect(out.groups[0]!.boards[0]!.localized).toBeUndefined();
    const none = doc([group([board("b", [])])]);
    expect(applyChips(none, ["A", "B", "C", "D"])).toBe(none);
  });

  it("retargeting scales the chips' type and gap", () => {
    const d = project();
    (d.groups[0]!.boards[0]!.elements[1] as unknown as { gap: number }).gap = 10;
    const c = retarget(d.groups[0]!, "x-post").boards[0]!.elements[1] as unknown as { fontSize: number; gap: number };
    const s = Math.min(1600 / 1024, 900 / 500);
    expect(c.fontSize).toBeCloseTo(6 * s);
    expect(c.gap).toBeCloseTo(10 * s);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @chitrapx/document exec vitest run test/chips.test.ts`
Expected: FAIL. `normalizeChips` is not exported.

- [ ] **Step 3: Types**

In `packages/document/src/artboard.ts`, add `| 'chips'` to `ElementType`. After `AudioElementProps`, add:

```ts
// SP11: feature chips, a row of pills (the Google Play feature graphic, key-feature lists). The list is the
// content; a language may give each chip its own words but shares the order and the count.
export interface ChipsElementProps extends BaseElement {
  type: 'chips';
  chips: string[];
  /** Same units as text: drawn at fontSize / 0.3, not multiplied by scale. */
  fontSize: number;
  fontFamily: string;
  fontWeight?: string;
  /** Chip text colour. */
  color: string;
  /** Chip background. */
  fillColor: string;
  /** Logical: 'left' is the side the language starts on. */
  align?: 'left' | 'center' | 'right';
  /** Space between chips in board px; default 0.4 of the drawn font size. */
  gap?: number;
}
```

Add `| ChipsElementProps` to `ArtboardElement`, and in `ElementLocaleOverride` after `marks`:

```ts
  /** Chips elements only: this language's words per chip, parallel to the base list; "" keeps the base chip. */
  chips?: string[];
```

- [ ] **Step 4: `chips.ts`**

`packages/document/src/chips.ts`:

```ts
import { produce } from "immer";
import type { ChipsElementProps } from "./artboard.ts";
import type { ChitrapxDoc } from "./doc.ts";

export const CHIP_MAX = 6;
export const CHIP_MIN = 4;
/** Stored per chip; a translation may run longer than the AI budget. */
export const CHIP_MAX_CHARS = 24;
/** What the AI is held to, and what the table warns above. */
export const CHIP_BUDGET = 16;

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, CHIP_MAX_CHARS).trim() : "");

/** A base list: trimmed, capped, no empty or repeated chips (case aside), at most six. */
export function normalizeChips(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    const t = clean(v);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length === CHIP_MAX) break;
  }
  return out;
}

/** A language's list: parallel to the base list, "" keeps the base chip; nothing left means no list. */
export function normalizeChipOverride(raw: unknown, baseLength: number): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.slice(0, Math.min(baseLength, CHIP_MAX)).map(clean);
  while (out.length && !out[out.length - 1]) out.pop();
  return out.length ? out : undefined;
}

/** What the AI proposed, held to the chip budget: one or two words, at most 16 characters, no repeats, at most six. */
export function aiChips(raw: unknown): string[] {
  const fits = (c: unknown) => typeof c === "string" && c.trim().length > 0 && c.trim().length <= CHIP_BUDGET && c.trim().split(/\s+/).length <= 2;
  return normalizeChips((Array.isArray(raw) ? raw : []).filter(fits));
}

/** The id one chip has in AI texts, the translations table and CSV files. */
export const chipId = (elementId: string, index: number) => `${elementId}#${index}`;
/** Element ids are UUIDs or template ids and never end in "#<digits>", so this cannot misread a text id. */
export function parseChipId(id: string): { elementId: string; index: number } | null {
  const m = /^(.+)#(\d+)$/.exec(id);
  return m ? { elementId: m[1]!, index: Number(m[2]) } : null;
}

/** What a chips override's sourceHash fingerprints. */
export const chipsSource = (chips: readonly string[]) => chips.join("\n");
export const isChips = (e: { type: string }): e is ChipsElementProps => e.type === "chips";
export const hasChips = (doc: ChitrapxDoc) => doc.groups.some((g) => [...g.spanElements, ...g.boards.flatMap((b) => b.elements)].some(isChips));

/** A language's list after the base list was reordered: `from[i]` is the old index of new chip i, -1 for a new chip. */
export function remapChipOverride(list: readonly string[] | undefined, from: readonly number[]): string[] | undefined {
  if (!list) return undefined;
  return normalizeChipOverride(from.map((j) => (j >= 0 ? list[j] ?? "" : "")), from.length);
}

/** New chips on every chips element (AI chips, AI design). The old chips' translations go with them. */
export function applyChips(doc: ChitrapxDoc, chips: string[]): ChitrapxDoc {
  const list = normalizeChips(chips);
  if (!list.length || !hasChips(doc)) return doc;
  return produce(doc, (d) => {
    for (const g of d.groups) {
      for (const e of g.spanElements) if (e.type === "chips") (e as unknown as ChipsElementProps).chips = [...list];
      for (const b of g.boards) {
        for (const e of b.elements) {
          if (e.type !== "chips") continue;
          (e as unknown as ChipsElementProps).chips = [...list];
          for (const byEl of Object.values(b.localized ?? {})) {
            const ov = byEl[e.id];
            if (!ov?.chips) continue;
            delete ov.chips; delete ov.origin; delete ov.sourceHash;
            if (!Object.keys(ov).length) delete byEl[e.id];
          }
        }
        for (const [locale, byEl] of Object.entries(b.localized ?? {})) if (!Object.keys(byEl).length) delete b.localized![locale];
        if (b.localized && !Object.keys(b.localized).length) delete b.localized;
      }
    }
  });
}
```

Append `export * from "./chips.ts";` to `packages/document/src/index.ts`.

- [ ] **Step 5: Schema**

In `packages/document/src/doc.ts`, add `import { normalizeChipOverride, normalizeChips } from "./chips.ts";` and add `"chips"` to the element `type` enum. Replace the block from `const isText = …` through the end of `normalizeRichText` with:

```ts
const isText = (e: Loose) => e.type === "text";
const isChipsEl = (e: Loose) => e.type === "chips";
const normalizeElement = (e: Loose): Loose =>
  isText(e) ? normalizeTextFields(e, String(e.content ?? "")) : isChipsEl(e) ? { ...e, chips: normalizeChips(e.chips) } : e;

/** A language's override: its marks against its own wording, its chips list against the base list's length. */
function normalizeOverride(ov: Loose, baseEl: Loose | undefined): Loose {
  const out = normalizeTextFields(ov, String(ov.content ?? baseEl?.content ?? ""), true);
  if (!("chips" in out)) return out;
  const chips = baseEl && isChipsEl(baseEl) ? normalizeChipOverride(out.chips, (baseEl.chips as unknown[]).length) : undefined;
  const next = { ...out };
  if (chips) next.chips = chips; else delete next.chips;
  return next;
}

/** Marks, gradients and chip lists are cleaned (clamped, split, merged, sorted, capped), never rejected for range problems. */
function normalizeRichText<T extends { groups: unknown[] }>(doc: T): T {
  for (const g of doc.groups as Array<{ boards: Loose[]; spanElements: Loose[] }>) {
    g.spanElements = g.spanElements.map(normalizeElement);
    for (const b of g.boards) {
      const elements = (b.elements as Loose[]).map(normalizeElement);
      b.elements = elements;
      const localized = b.localized as Record<string, Record<string, Loose>> | undefined;
      if (!localized) continue;
      const base = new Map(elements.map((e) => [e.id, e]));
      b.localized = Object.fromEntries(Object.entries(localized).map(([loc, byEl]) => [loc, Object.fromEntries(Object.entries(byEl ?? {}).map(([id, ov]) =>
        [id, ov && typeof ov === "object" ? normalizeOverride(ov, base.get(id)) : ov]))]));
    }
  }
  return doc;
}
```

- [ ] **Step 6: Texts, translations, retarget**

In `packages/document/src/ai.ts`, add `import type { ChipsElementProps } from "./artboard.ts";` and `import { CHIP_MAX_CHARS, chipId, chipsSource, normalizeChipOverride } from "./chips.ts";`. Replace `allTexts`, `applyTexts` and `applyTranslations` with:

```ts
/** Every distinct base text in the document (deduplicated by id across boards and sizes); chips as `<id>#<n>`. */
export function allTexts(doc: ChitrapxDoc): SlotText[] {
  const seen = new Map<string, string>();
  for (const g of doc.groups) for (const b of g.boards) for (const e of b.elements) {
    if (isText(e)) { if (!seen.has(e.id)) seen.set(e.id, e.content ?? ""); }
    else if (e.type === "chips") (e as ChipsElementProps).chips.forEach((c, i) => { const id = chipId(e.id, i); if (!seen.has(id)) seen.set(id, c); });
  }
  return [...seen].map(([id, text]) => ({ id, text }));
}
```

```ts
/** Sets base text for every element with that id, on every board of every size; chip ids set one chip. */
export function applyTexts(doc: ChitrapxDoc, texts: SlotText[]): ChitrapxDoc {
  const byId = new Map(texts.map((t) => [t.id, t.text]));
  return produce(doc, (d) => {
    for (const g of d.groups) for (const b of g.boards) for (const e of b.elements) {
      if (e.type === "chips") {
        const el = e as unknown as ChipsElementProps;
        const next = el.chips.map((c, i) => byId.get(chipId(el.id, i))?.trim().slice(0, CHIP_MAX_CHARS) || c);
        if (next.some((c, i) => c !== el.chips[i])) el.chips = next;
        continue;
      }
      const text = byId.get(e.id);
      if (text !== undefined && e.type === "text") setContent(e as TextElementProps, text.trim().slice(0, budget((e as TextElementProps).content ?? "")));
    }
  });
}
```

```ts
export function applyTranslations(doc: ChitrapxDoc, locale: string, texts: SlotText[], opts: TranslateApply = {}): ChitrapxDoc {
  if (locale === doc.localization.baseLocale) return doc;
  const byId = new Map(texts.map((t) => [t.id, t.text.trim()]));
  const from = opts.sourceLocale && opts.sourceLocale !== doc.localization.baseLocale ? opts.sourceLocale : null;
  const changedSince = (id: string, now: string) => !!opts.sources?.has(id) && opts.sources.get(id) !== now;
  return produce(doc, (d) => {
    if (!d.localization.locales.some((l) => l.code === locale)) d.localization.locales.push({ code: locale });
    for (const g of d.groups) for (const b of g.boards) for (const e of b.elements) {
      const current = b.localized?.[locale]?.[e.id];
      const manual = (has: unknown) => has !== undefined && current?.origin !== "auto" && !opts.overwriteManual; // a person wrote this
      if (e.type === "chips") {
        const el = e as unknown as ChipsElementProps;
        const words = el.chips.map((_, i) => byId.get(chipId(el.id, i)));
        if (!words.some(Boolean) || manual(current?.chips)) continue;
        const src = from ? b.localized?.[from]?.[el.id]?.chips : undefined;
        if (el.chips.some((c, i) => changedSince(chipId(el.id, i), src?.[i] || c))) continue;
        const chips = normalizeChipOverride(words.map((w, i) => w?.slice(0, CHIP_MAX_CHARS) || current?.chips?.[i] || ""), el.chips.length);
        if (!chips) continue;
        ((b.localized ??= {})[locale] ??= {})[el.id] = { ...current, chips, origin: "auto", sourceHash: hash32(chipsSource(el.chips)) };
        continue;
      }
      const text = byId.get(e.id);
      if (text === undefined || e.type !== "text") continue;
      const base = (e as TextElementProps).content ?? "";
      if (changedSince(e.id, from ? (b.localized?.[from]?.[e.id]?.content || base) : base)) continue;
      if (manual(current?.content)) continue;
      const next = text.slice(0, budget(base));
      // The language's own marks were offsets into its old wording.
      const { marks: old, ...rest } = current ?? {};
      ((b.localized ??= {})[locale] ??= {})[e.id] = {
        ...rest, ...(current?.content === next && old ? { marks: old } : {}), content: next, origin: "auto", sourceHash: hash32(base),
      };
    }
  });
}
```

In `packages/document/src/translations.ts`:
- Add `import type { ChipsElementProps } from "./artboard.ts";` and `import { CHIP_BUDGET, CHIP_MAX_CHARS, chipId, chipsSource, normalizeChipOverride, parseChipId } from "./chips.ts";`.
- Add `/** Chips rows: which chip of the element. */ chip?: number;` to `TranslationRow`.
- Replace `translationRows`, `cellFor`, `lengthWarning`, `writeTranslations` and `textsIn` with:

```ts
/** Every localizable text once, in board order of the first size it appears in. Empty texts are not rows; chips are one row each. */
export function translationRows(doc: ChitrapxDoc): TranslationRow[] {
  const seen = new Set<string>();
  const rows: TranslationRow[] = [];
  for (const g of doc.groups) for (const b of g.boards) for (const e of b.elements) {
    if (seen.has(e.id)) continue;
    if (e.type === "text") {
      const t = e as TextElementProps;
      if (!t.content?.trim()) continue;
      seen.add(t.id);
      rows.push({ id: t.id, elementId: t.id, board: b.name, boardId: b.id, label: rowLabel(t), base: t.content, source: t.content });
    } else if (e.type === "chips") {
      const c = e as ChipsElementProps;
      seen.add(c.id);
      const name = c.name?.trim() || "Chip";
      c.chips.forEach((chip, i) => rows.push({ id: chipId(c.id, i), elementId: c.id, chip: i, board: b.name, boardId: b.id, label: `${name} ${i + 1}`, base: chip, source: chipsSource(c.chips) }));
    }
  }
  return rows;
}
```

```ts
export function cellFor(doc: ChitrapxDoc, row: TranslationRow, locale: string): TranslationCell {
  const ov = overrideOf(doc, locale, row.elementId);
  const text = (row.chip === undefined ? ov?.content : ov?.chips?.[row.chip]) ?? "";
  return text.trim() ? { text, state: stateOf(ov!, row.source) } : { text: "", state: "untranslated" };
}
```

```ts
/** Advice under a cell. What renders is still decided by auto-shrink at render time; chips wrap or drop. */
export function lengthWarning(row: TranslationRow, text: string): string | null {
  if (!text) return null;
  if (row.chip !== undefined) return text.length > CHIP_BUDGET ? "Chips fit best at 16 characters or fewer" : null;
  return text.length > Math.ceil(row.base.length * 1.5) + 4 ? "Longer than the source; it may shrink or wrap" : null;
}
```

```ts
export function writeTranslations(doc: ChitrapxDoc, writes: TranslationWrite[]): ChitrapxDoc {
  const known = new Set(doc.localization.locales.map((l) => l.code));
  const texts = new Map<string, string>();
  const chipEdits = new Map<string, Map<number, string>>();
  for (const w of writes) {
    if (!known.has(w.locale)) continue;
    const text = w.text.replace(/\r\n?/g, "\n");
    const chip = parseChipId(w.id);
    if (chip) {
      const key = `${w.locale}\u0000${chip.elementId}`;
      chipEdits.set(key, (chipEdits.get(key) ?? new Map()).set(chip.index, text.replace(/\s+/g, " ").trim().slice(0, CHIP_MAX_CHARS)));
    } else texts.set(`${w.locale}\u0000${w.id}`, text);
  }
  if (!texts.size && !chipEdits.size) return doc;
  return produce(doc, (d) => {
    for (const g of d.groups) for (const b of g.boards) for (const e of b.elements) {
      for (const locale of known) {
        const current = b.localized?.[locale]?.[e.id];
        if (e.type === "chips") {
          const el = e as unknown as ChipsElementProps;
          const edits = chipEdits.get(`${locale}\u0000${el.id}`);
          if (!edits) continue;
          const list = el.chips.map((_, i) => current?.chips?.[i] ?? "");
          for (const [i, t] of edits) if (i < list.length) list[i] = t;
          const chips = normalizeChipOverride(list, el.chips.length);
          if (JSON.stringify(chips) === JSON.stringify(current?.chips)) continue;
          const next: ElementLocaleOverride = { ...current };
          if (chips) { next.chips = chips; next.origin = "manual"; next.sourceHash = hash32(chipsSource(el.chips)); }
          else { delete next.chips; delete next.origin; delete next.sourceHash; }
          put(b, locale, el.id, next);
          continue;
        }
        if (e.type !== "text") continue;
        const base = (e as TextElementProps).content ?? "";
        const text = texts.get(`${locale}\u0000${e.id}`);
        if (text === undefined || (current?.content ?? "") === text) continue;
        const next: ElementLocaleOverride = { ...current };
        if (text === "") {
          delete next.content; delete next.marks; delete next.origin; delete next.sourceHash;
        } else {
          if (next.marks?.length) {
            const m = remapMarks(current?.content ?? base, text, next.marks);
            if (m.length) next.marks = m; else delete next.marks;
          }
          next.content = text;
          next.origin = "manual";
          next.sourceHash = hash32(base);
        }
        put(b, locale, e.id, next);
      }
    }
  });
}
```

```ts
/** Every distinct text as `locale` reads it: that language's own text where it has one, the base text otherwise. */
export function textsIn(doc: ChitrapxDoc, locale: string): SlotText[] {
  const all = allTexts(doc);
  if (locale === doc.localization.baseLocale) return all;
  return all.map((t) => {
    const chip = parseChipId(t.id);
    const ov = overrideOf(doc, locale, chip ? chip.elementId : t.id);
    const own = chip ? ov?.chips?.[chip.index] : ov?.content;
    return own?.trim() ? { id: t.id, text: own } : t;
  });
}
```

In `packages/document/src/retarget.ts`, replace `if (out.type === "text") out.fontSize = out.fontSize * s;` with:

```ts
    if (out.type === "text" || out.type === "chips") out.fontSize = out.fontSize * s;
    if (out.type === "chips" && out.gap !== undefined) out.gap = out.gap * s;
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/web exec vitest run test/commands.test.ts`
Expected: PASS. The SP10 schema tests and the Task 4–5 translation tests also pass.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm typecheck`
Expected: the only error is `billing.ts:61`. If a `switch` over element types in the renderer or the web app (for example a Layers panel icon) is no longer exhaustive, add a `chips` arm that does what its `default` arm does.

```bash
git add packages/document
git commit -m "feat(document): chips element with per-language lists, in texts, translations and retargeting"
```

---

### Task 11: Chips render as pills

**Files:**
- Create: `packages/renderer/src/osg/elements/ChipsElement.tsx`
- Modify: `packages/renderer/src/osg/StaticArtboard.tsx`, `packages/renderer/src/osg/i18n/project.ts` (`isEmptyOverride`, chips projection, fonts), `packages/renderer/src/osg/i18n/localization.ts` (`isOverrideEmpty`, `isEmptyOverride`), `packages/renderer/src/fonts.tsx` (`fontUsesOf`)
- Modify: `apps/worker/test-e2e/export.test.ts` (chips golden)
- Create (generated): `packages/assets/golden/chips-de.png`
- Test: `packages/renderer/test/chips.test.tsx` (create)

**Interfaces:**
- Produces:
  - `ChipsElement({ element: ChipsElementProps })`
  - `chipRows(height, fontPx, gap): number`: the whole rows of pills a box holds, at least 1.
  - A pill is `fontPx × 1.9` tall, padded `0.9em` either side, and the default gap is `0.4 × fontPx`.

- [ ] **Step 1: Failing tests**

`packages/renderer/test/chips.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArtboardState, ChipsElementProps } from "@chitrapx/document";
import { fontUsesOf } from "../src/fonts.tsx";
import { chipRows, ChipsElement } from "../src/osg/elements/ChipsElement";
import { projectArtboards } from "../src/osg/i18n/project";

const chips = (extra: Partial<ChipsElementProps> = {}): ChipsElementProps => ({ id: "c", type: "chips", chips: ["Fast", "Private", "Offline"], fontSize: 6, fontFamily: "Inter",
  fontWeight: "600", color: "#ffffff", fillColor: "#4f46e5", position: { x: 0, y: 0 }, size: { width: 480, height: 96 }, rotation: 0, scale: 1, ...extra });
const html = (extra: Partial<ChipsElementProps> = {}) => renderToStaticMarkup(<ChipsElement element={chips(extra)} />);

describe("ChipsElement", () => {
  it("draws one pill per chip in the box's colours and face, direction from content", () => {
    const h = html();
    expect(h.match(/<span/g)).toHaveLength(3);
    expect(h).toContain('dir="auto"');
    expect(h).toContain("background:#4f46e5");
    expect(h).toContain(">Private</span>");
    expect(h).toContain("font-size:20px");
  });

  it("cuts the box to whole rows, so a chip that would wrap past it is dropped, not overlapped", () => {
    // 6 / 0.3 = 20 px type: 38 px pills and 8 px gaps. 96 px holds two rows, 40 px holds one.
    expect(chipRows(96, 20, 8)).toBe(2);
    expect(chipRows(40, 20, 8)).toBe(1);
    expect(chipRows(10, 20, 8)).toBe(1);
    expect(html({ size: { width: 480, height: 40 } })).toContain('data-chips="" style="width:100%;height:38px;');
    expect(html()).toContain('data-chips="" style="width:100%;height:84px;');
    expect(html()).toContain("overflow:hidden");
  });

  it("aligns to the logical start, centre or end", () => {
    expect(html()).toContain("justify-content:flex-start");
    expect(html({ align: "center" })).toContain("justify-content:center");
    expect(html({ align: "right" })).toContain("justify-content:flex-end");
  });
});

describe("chips per language", () => {
  const board = (ov: Record<string, unknown>, code = "de-DE"): ArtboardState => ({ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 1024, height: 500 },
    backgroundColor: "#fff", zoom: 1, elements: [chips()], localization: { baseLocale: "en-US", locales: [{ code }] }, localized: { [code]: { c: ov } } } as unknown as ArtboardState);
  const shown = (ov: Record<string, unknown>, code = "de-DE") => projectArtboards([board(ov, code)], code)[0]!.elements[0] as ChipsElementProps;

  it("a language's words replace the base chips one by one; a blank keeps the base chip", () => {
    expect(shown({ chips: ["Schnell", "", "Offline-Modus"] }).chips).toEqual(["Schnell", "Private", "Offline-Modus"]);
  });

  it("Arabic chips get the Arabic face, and the stylesheet asks for the chips' face", () => {
    expect(shown({ chips: ["سريع"] }, "ar-SA").fontFamily).toBe("Noto Sans Arabic");
    expect(fontUsesOf([{ ...board({}), elements: [chips()] }])).toEqual([{ family: "Inter", faces: [{ weight: 600, italic: false }] }]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @chitrapx/renderer exec vitest run test/chips.test.tsx`
Expected: FAIL. The module does not exist.

- [ ] **Step 3: The element**

`packages/renderer/src/osg/elements/ChipsElement.tsx`:

```tsx
"use client";
import type { ChipsElementProps } from '@chitrapx/document';
import { cssFontFamily } from '../lib/fontService';

/** Same display compensation TextElement uses: type is drawn at fontSize / 0.3 board px. */
const DISPLAY_SCALE = 0.3;
const LINE = 1.2;
const PAD_Y = 0.35;
const PAD_X = 0.9;

/** How many whole rows of pills fit `height`; never fewer than one. */
export function chipRows(height: number, fontPx: number, gap: number): number {
  const pill = fontPx * (LINE + 2 * PAD_Y);
  return Math.max(1, Math.floor((height + gap) / (pill + gap)));
}

/**
 * Pills that wrap like words. The box is cut to the whole rows it holds, so a chip that would wrap past the
 * bottom is dropped whole, never half drawn or laid over the next element. dir="auto" puts an Arabic list's
 * first chip on the right, and the logical alignment follows it, as text does.
 */
export function ChipsElement({ element }: { element: ChipsElementProps }) {
  const fontPx = element.fontSize / DISPLAY_SCALE;
  const gap = element.gap ?? fontPx * 0.4;
  const pill = fontPx * (LINE + 2 * PAD_Y);
  const rows = chipRows(element.size.height * (element.scale || 1), fontPx, gap);
  const justify = element.align === 'center' ? 'center' : element.align === 'right' ? 'flex-end' : 'flex-start';
  return (
    <div dir="auto" data-chips="" style={{
      width: '100%', height: rows * pill + (rows - 1) * gap, display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start',
      justifyContent: justify, gap, overflow: 'hidden',
    }}>
      {(element.chips ?? []).map((chip, i) => (
        <span key={i} style={{
          display: 'inline-block', height: pill, lineHeight: `${pill}px`, maxWidth: '100%', boxSizing: 'border-box',
          padding: `0 ${fontPx * PAD_X}px`, borderRadius: pill / 2, background: element.fillColor, color: element.color,
          fontFamily: cssFontFamily(element.fontFamily), fontSize: fontPx, fontWeight: element.fontWeight || '600',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{chip}</span>
      ))}
    </div>
  );
}
```

In `packages/renderer/src/osg/StaticArtboard.tsx`, add `import { ChipsElement } from './elements/ChipsElement';` and `ChipsElementProps` to the type import. After the `gesture` branch, add:

```tsx
            {element.type === 'chips' && <ChipsElement element={element as ChipsElementProps} />}
```

- [ ] **Step 4: Projection, emptiness and faces**

In `packages/renderer/src/osg/i18n/project.ts`:
- Add `ChipsElementProps` to the type import.
- In `isEmptyOverride`, after the `marks` line, add `if (ov.chips !== undefined) return false;`.
- In `resolveElementForLocale`, after the marks block, add:

```ts
  // SP11: a chips list in this language replaces the base chips one by one; "" keeps the base chip.
  if (el.type === 'chips' && ov.chips !== undefined) {
    const baseChips = (el as ChipsElementProps).chips ?? [];
    const shown = baseChips.map((c, i) => ov.chips?.[i]?.trim() || c);
    if (!sameValue(shown, baseChips)) assign('chips', shown);
  }
```

Replace the line `if (el.type !== 'text') return next;` (the one just before the auto font block) with `if (el.type !== 'text' && el.type !== 'chips') return next;`. Then insert `if (el.type !== 'text') return next;` right after the auto font block, before the leading block from Task 8, so chips get the script's face but not text leading or auto-shrink.

In `packages/renderer/src/osg/i18n/localization.ts`, add `ov.chips === undefined &&` to the conditions of both `isOverrideEmpty` and the private `isEmptyOverride`, next to `ov.content === undefined`.

In `packages/renderer/src/fonts.tsx`, add `type ChipsElementProps` to the document import. Replace the loop body in `fontUsesOf` with:

```tsx
  for (const b of boards) for (const el of b.elements) {
    if (el.type === "chips") {
      const c = el as ChipsElementProps;
      if (c.fontFamily?.trim()) add(c.fontFamily.trim(), parseWeight(c.fontWeight ?? "600"), false);
      continue;
    }
    if (el.type !== "text") continue;
    const t = el as TextElementProps;
    const family = t.fontFamily?.trim();
    if (!family) continue;
    const weight = parseWeight(t.fontWeight), italic = t.fontStyle === "italic";
    add(family, weight, italic);
    // Weight marks use the same family: request those faces too (the nearest one the family has).
    for (const m of t.marks ?? []) add(family, m.fontWeight ?? weight, m.italic ?? italic);
  }
```

- [ ] **Step 5: Golden**

Append to `apps/worker/test-e2e/export.test.ts`:

```ts
describe("chips (SP11)", () => {
  it("German chips on a feature graphic render as pills, within the box, and match their golden", async () => {
    const doc = await templateDoc("fg-food-delivery");
    const b = doc.groups[0]!.boards[0]!;
    b.elements = b.elements.filter((e) => e.type !== "chips");
    b.elements.push({ id: "e2e-chips", type: "chips", name: "Chips", chips: ["Fast delivery", "Live tracking", "Top restaurants"], fontSize: 6.6,
      fontFamily: "Bricolage Grotesque", fontWeight: "600", color: "#E5502A", fillColor: "#FFFFFF", align: "left",
      position: { x: 58, y: 384 }, size: { width: 480, height: 96 }, rotation: 0, scale: 1 } as never);
    doc.localization = { baseLocale: "en-US", locales: [{ code: "de-DE" }] };
    b.localized = { "de-DE": { "e2e-chips": { chips: ["Schnelle Lieferung", "Live-Verfolgung", "Top-Restaurants"], origin: "manual" } } };
    const { ws, appId } = await workspaceWithApp();
    compareGolden("chips-de.png", await localePng(ws, appId, migrate(doc), "de-DE"));
  }, 180_000);
});
```

- [ ] **Step 6: Run the unit tests, then the e2e suite**

Run: `pnpm --filter @chitrapx/renderer test`
Expected: PASS.

Then, with the dev-server commands in Global Constraints, run `pnpm --filter @chitrapx/worker test:e2e`.
Expected: PASS, with `chips-de.png` written. Open it: there are three white pills with orange German text below the subtitle, in at most two rows. None touches the board edge or the phone. Run the suite again. Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: the only error is `billing.ts:61`.

```bash
git add packages/renderer apps/worker/test-e2e packages/assets/golden
git commit -m "feat(renderer): chips render as pills that wrap and drop whole rows instead of overlapping"
```

---

### Task 12: Chips in the editor, and four feature graphics with chips

**Files:**
- Create: `apps/web/src/editor/ui/ChipsEditor.tsx`
- Modify: `apps/web/src/editor/commands.ts` (`setChips`), `apps/web/src/editor/ui/Inspector.tsx` (chips section), `apps/web/src/editor/ui/LeftPanel.tsx` (adder)
- Modify: `packages/document/src/catalog.ts` (`chips` per board), `packages/assets/templates/fg-food-delivery.json`, `fg-habit-tracker.json`, `fg-music-stream.json`, `fg-travel-explore.json`, `packages/assets/catalog.json` (regenerated)
- Test: `apps/web/test/commands.test.ts` (append), `packages/document/test/catalog.test.ts` (append)

**Interfaces:**
- Produces:
  - the command `{ type: "setChips"; ref: Ref; chips: string[]; from: number[] }`, where `from[i]` is the old index of new chip i, or -1 for a new chip. Every language's list on that board follows.
  - `ChipsEditor({ refr, el, locale: string | null })`
  - `CatalogEntry.boards[i].chips?: number`, present only when non-zero.
- The chips element ids in the templates are `food-chips`, `habit-chips`, `music-chips` and `travel-chips`.

- [ ] **Step 1: Failing tests**

Append to `apps/web/test/commands.test.ts`:

```ts
describe("chips (SP11)", () => {
  function chipsDoc(): ChitrapxDoc {
    const d = doc();
    d.groups[0]!.boards[0]!.elements.push({ id: "c", type: "chips", chips: ["Fast", "Private", "Offline"], fontSize: 6, fontFamily: "Inter", color: "#fff", fillColor: "#000",
      position: { x: 0, y: 0 }, size: { width: 400, height: 90 }, rotation: 0, scale: 1 } as unknown as ArtboardElement);
    d.groups[0]!.boards[0]!.localized = { "de-DE": { c: { chips: ["Schnell", "Privat", ""], origin: "manual" } } };
    return d;
  }
  const chipsOf = (d: ChitrapxDoc) => (findElement(d, r("c")) as unknown as { chips: string[] }).chips;
  const deOf = (d: ChitrapxDoc) => d.groups[0]!.boards[0]!.localized!["de-DE"]!.c!.chips;

  it("moving and deleting chips carries every language's words with them", () => {
    // "Offline" to the front, "Private" removed.
    const d = applyCommand(chipsDoc(), { type: "setChips", ref: r("c"), chips: ["Offline", "Fast"], from: [2, 0] });
    expect(chipsOf(d)).toEqual(["Offline", "Fast"]);
    expect(deOf(d)).toEqual(["", "Schnell"]);
  });

  it("a new chip has no translation yet, and an unchanged list is no step", () => {
    const d0 = chipsDoc();
    expect(deOf(applyCommand(d0, { type: "setChips", ref: r("c"), chips: ["Fast", "Private", "Offline", "Sync"], from: [0, 1, 2, -1] }))).toEqual(["Schnell", "Privat"]);
    expect(applyCommand(d0, { type: "setChips", ref: r("c"), chips: ["Fast", "Private", "Offline"], from: [0, 1, 2] })).toBe(d0);
  });
});
```

Append to `packages/document/test/catalog.test.ts`:

```ts
it("feature graphics with chips say so, and only those", () => {
  const catalog = JSON.parse(renderCatalog()) as Array<{ slug: string; boards: Array<{ chips?: number }> }>;
  const withChips = catalog.filter((c) => c.boards.some((b) => b.chips)).map((c) => c.slug);
  expect(withChips).toEqual(["fg-food-delivery", "fg-habit-tracker", "fg-music-stream", "fg-travel-explore"]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @chitrapx/web exec vitest run test/commands.test.ts && pnpm --filter @chitrapx/document exec vitest run test/catalog.test.ts`
Expected: FAIL. `setChips` is unknown and no template has chips.

- [ ] **Step 3: Command**

In `apps/web/src/editor/commands.ts`, add `CHIP_MAX`, `CHIP_MAX_CHARS`, `remapChipOverride` and `type ChipsElementProps` to the `@chitrapx/document` import, and `| { type: "setChips"; ref: Ref; chips: string[]; from: number[] }` to `Command`. In the `switch`:

```ts
      case "setChips": {
        const el = list(d, cmd.ref.groupId, cmd.ref.boardId)?.find((e) => e.id === cmd.ref.elementId) as unknown as ChipsElementProps | undefined;
        if (!el || el.type !== "chips") return;
        const next = cmd.chips.map((c) => c.replace(/\s+/g, " ").trim().slice(0, CHIP_MAX_CHARS)).slice(0, CHIP_MAX);
        const from = cmd.from.slice(0, next.length);
        if (next.length === el.chips.length && next.every((c, i) => c === el.chips[i]) && from.every((j, i) => j === i)) return;
        el.chips = next;
        // Every language's words follow their chip to its new place; a new chip starts untranslated.
        const b = cmd.ref.boardId ? findBoard(d, cmd.ref.groupId, cmd.ref.boardId) : undefined;
        for (const byEl of Object.values(b?.localized ?? {})) {
          const ov = byEl[el.id];
          if (!ov?.chips) continue;
          const remapped = remapChipOverride(ov.chips, from);
          if (remapped) ov.chips = remapped;
          else { delete ov.chips; delete ov.origin; delete ov.sourceHash; }
          if (!Object.keys(ov).length) delete byEl[el.id];
        }
        return;
      }
```

- [ ] **Step 4: Chips editor, inspector, adder**

`apps/web/src/editor/ui/ChipsEditor.tsx`:

```tsx
"use client";

import { useState } from "react";
import { CHIP_BUDGET, CHIP_MAX, chipId, type ChipsElementProps, type ElementLocaleOverride } from "@chitrapx/document";
import { api } from "@/server/api.ts";
import type { Ref } from "../commands.ts";
import { useEditor, useEditorStore } from "../context.tsx";
import { useDocJob } from "../docJobs.tsx";

/** A chips list. The base language owns the order and the count; another language edits the words only. */
export function ChipsEditor({ refr, el, locale }: { refr: Ref; el: ChipsElementProps; locale: string | null }) {
  const store = useEditorStore();
  const run = useDocJob();
  const projectId = useEditor((s) => s.projectId);
  const locked = useEditor((s) => s.locked);
  const override = useEditor((s): ElementLocaleOverride | undefined => locale && refr.boardId
    ? s.doc.groups.find((g) => g.id === refr.groupId)?.boards.find((b) => b.id === refr.boardId)?.localized?.[locale]?.[refr.elementId] : undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chips = el.chips ?? [];

  const setBase = (next: string[], from: number[]) => store.getState().apply({ type: "setChips", ref: refr, chips: next, from });
  const identity = () => chips.map((_, k) => k);
  const remove = (i: number) => { const order = identity().filter((k) => k !== i); setBase(order.map((k) => chips[k]!), order); };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= chips.length) return;
    const order = identity();
    [order[i], order[j]] = [order[j]!, order[i]!];
    setBase(order.map((k) => chips[k]!), order);
  };
  function edit(i: number, text: string) {
    if (locale) store.getState().apply({ type: "setTranslations", writes: [{ locale, id: chipId(el.id, i), text }] });
    else if (!text.trim()) remove(i);
    else setBase(chips.map((c, k) => (k === i ? text : c)), identity());
  }
  async function regenerate() {
    setBusy(true);
    setError("");
    try { await run(() => api<{ jobId: string }>(`/api/projects/${projectId}/chips`, "POST")); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <section className="space-y-1.5" aria-label="Chips">
      <h3 className="label">Chips</h3>
      {chips.map((chip, i) => {
        const value = locale ? override?.chips?.[i] ?? "" : chip;
        return (
          <div key={i} className="flex items-center gap-1">
            <input key={`${i}:${value}`} className="input flex-1 py-1 text-xs" dir="auto" defaultValue={value} placeholder={chip} disabled={locked}
              aria-label={`Chip ${i + 1}${locale ? ` in ${locale}` : ""}`} onBlur={(e) => e.target.value !== value && edit(i, e.target.value)} />
            {value.length > CHIP_BUDGET && <span className="text-[10px] text-amber-700" title="Chips fit best at 16 characters or fewer">long</span>}
            {!locale && (
              <>
                <button type="button" className="btn-ghost px-1 py-0.5 text-xs" aria-label={`Move chip ${i + 1} up`} disabled={i === 0 || locked} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="btn-ghost px-1 py-0.5 text-xs" aria-label={`Move chip ${i + 1} down`} disabled={i === chips.length - 1 || locked} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="btn-ghost px-1 py-0.5 text-xs" aria-label={`Delete chip ${i + 1}`} disabled={locked} onClick={() => remove(i)}>x</button>
              </>
            )}
          </div>
        );
      })}
      {locale ? (
        <p className="text-xs text-neutral-500">Order and number of chips are shared by every language.</p>
      ) : (
        <div className="flex gap-1">
          <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={chips.length >= CHIP_MAX || locked}
            onClick={() => setBase([...chips, "New chip"], [...identity(), -1])}>Add chip</button>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={busy || locked} onClick={regenerate}>
            {busy ? "Writing chips" : "Regenerate chips (1 credit)"}
          </button>
        </div>
      )}
      {error && <p role="alert" className="error text-xs">{error}</p>}
    </section>
  );
}
```

In `apps/web/src/editor/ui/Inspector.tsx`:
- Add `import { ChipsEditor } from "./ChipsEditor.tsx";` and `ChipsElementProps` to the document type import.
- Extend `AnyFields` with `& { align?: "left" | "center" | "right"; chips?: string[] }`.
- After the `el.type === "text"` block, add:

```tsx
      {el.type === "chips" && (
        <>
          <ChipsEditor refr={refr} el={el as ChipsElementProps} locale={localized ? locale : null} />
          <FontPicker id="i-chips-font" label="Font" value={a.fontFamily ?? ""} used={used} custom={custom} onChange={(v) => set({ fontFamily: v })} />
          <div className="grid grid-cols-2 gap-2">
            <NumberField id="i-chips-size" label="Size" value={a.fontSize ?? 7} min={1} step={0.5} onChange={(v) => set({ fontSize: Math.max(1, v) })} />
            <SelectField id="i-chips-weight" label="Weight" value={String(a.fontWeight ?? "600")} options={WEIGHTS} onChange={(v) => set({ fontWeight: v })} />
          </div>
          <ColorField id="i-chips-text" label="Text colour" value={a.color ?? "#111111"} onChange={(v) => set({ color: v })} />
          <ColorField id="i-chips-fill" label="Chip colour" value={a.fillColor ?? "#ffffff"} onChange={(v) => set({ fillColor: v })} />
          <div className="flex gap-1" role="group" aria-label="Chip alignment">
            {(["left", "center", "right"] as const).map((al) => (
              <button key={al} type="button" className={(a.align ?? "left") === al ? "btn flex-1 px-2" : "btn-ghost flex-1 px-2"} onClick={() => set({ align: al })}>{al[0]!.toUpperCase() + al.slice(1)}</button>
            ))}
          </div>
        </>
      )}
```

In `apps/web/src/editor/ui/LeftPanel.tsx`, add to `ADDERS` after "Text":

```ts
  ["Chips", (w, h) => ({ ...base(w, h, w * 0.47, w * 0.094), type: "chips", name: "Chips", chips: ["Fast", "Private", "Offline"],
    fontSize: Math.round(w * 0.0225 * 0.3 * 10) / 10 /* drawn at fontSize / 0.3 px, like text */, fontFamily: "Bricolage Grotesque", fontWeight: "600",
    color: "#111111", fillColor: "#ffffff", align: "left" })],
```

- [ ] **Step 5: Templates and catalogue**

In `packages/document/src/catalog.ts`, change the `boards` entry type to `Array<{ devices: number; texts: number; chips?: number }>` and the mapping to:

```ts
        boards: g.boards.map((b) => {
          const chips = b.elements.filter((e) => e.type === "chips").length;
          return { devices: b.elements.filter((e) => e.type === "device").length, texts: b.elements.filter((e) => e.type === "text").length, ...(chips ? { chips } : {}) };
        }),
```

Add the four chips elements to the templates. The positions sit below each subtitle and clear of the phone and badges; the colours are taken from each template. Then regenerate the catalogue:

```bash
node -e '
const fs = require("fs");
const el = (id, y, h, chips, color, fillColor) => ({ id, type: "chips", name: "Feature chips", position: { x: 58, y }, size: { width: 480, height: h },
  rotation: 0, scale: 1, chips, fontSize: 6.6, fontFamily: "Bricolage Grotesque", fontWeight: "600", color, fillColor, align: "left" });
const add = {
  "fg-food-delivery": el("food-chips", 384, 96, ["Fast delivery", "Live tracking", "Top restaurants"], "#E5502A", "#FFFFFF"),
  "fg-habit-tracker": el("habit-chips", 384, 96, ["Daily streaks", "Reminders", "Insights"], "#C6F7E2", "#0F4230"),
  "fg-music-stream": el("music-chips", 398, 92, ["Offline mode", "No ads", "Lyrics"], "#FFFFFF", "#2A1147"),
  "fg-travel-explore": el("travel-chips", 384, 96, ["Offline maps", "Trip planner", "Local picks"], "#0E5E66", "#FFFFFF"),
};
for (const [slug, chips] of Object.entries(add)) {
  const path = `packages/assets/templates/${slug}.json`;
  const t = JSON.parse(fs.readFileSync(path, "utf8"));
  const els = t.doc.groups[0].boards[0].elements;
  if (!els.some((e) => e.id === chips.id)) els.push(chips);
  fs.writeFileSync(path, JSON.stringify(t, null, 1) + "\n");
}'
pnpm --filter @chitrapx/document gen-catalog
pnpm db:seed
```

Expected: `catalog.json written`, and `git diff --stat packages/assets` shows the four templates and `catalog.json` changed.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/web exec vitest run test/commands.test.ts`
Expected: PASS, `templates.test.ts` (101 files) included.

- [ ] **Step 7: Browser check**

Start the web dev server with the dev-server commands in Global Constraints. Create a project from "Habit Tracker" (Play feature graphic):
- The chips show under the subtitle. Select them: the inspector lists three chips.
- Move one up, delete one, add one: each is one undo step.
- Add `de-DE` and switch to it. Typing a German chip changes only that pill, and the order buttons are hidden with the shared-order note.
- In `en-US`, move that chip: it keeps its German words in `de-DE`.
- "Add" → "Chips" places a list on a phone board.

Stop the server by PID.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: the only error is `billing.ts:61`.

```bash
git add apps/web packages/document packages/assets
git commit -m "feat(editor): add, edit, reorder and translate chips; four feature graphic templates carry chips"
```

---

### Task 13: Regenerate chips for 1 credit (`ai_chips`)

**Files:**
- Create: `apps/web/src/app/api/projects/[projectId]/chips/route.ts`
- Modify: `packages/db/src/pricing.ts` (`ai_chips`), `packages/db/src/credits.ts` (`EXPIRE_SECONDS`), `packages/document/src/ai.ts` (`chipsPlanSchema`), `apps/worker/src/ai/prompts.ts` (`CHIPS_SYSTEM`, `chipExamples`, `chipsPrompt`), `apps/worker/src/ai/jobs.ts` (`runAiChips`), `apps/worker/src/handlers.ts`, `apps/web/src/server/ai.ts` (`startChips`), `apps/web/src/components/jobText.ts`
- Test: `packages/db/test/credits.test.ts` (append), `apps/worker/test/ai.test.ts` (append), `apps/worker/test/prompts.test.ts` (append), `apps/web/test/ai.test.ts` (append)

**Interfaces:**
- Produces:
  - `PRICES.ai_chips = 1`
  - `chipsPlanSchema = z.object({ features: z.array(z.string()) })`
  - `CHIPS_SYSTEM`, `chipExamples(app)`, `chipsPrompt(app, insights, texts)`
  - `runAiChips(raw, job, deps)`: output `{ chips, usage }`
  - `startChips(ctx, boss, projectId)` (error `no_chips`)
  - `POST /api/projects/[projectId]/chips` → `{ jobId }` (201)
- Consumes: `hasChips`, `aiChips`, `applyChips`, `CHIP_MIN` (Task 10), `appBrief` (Task 3). `ChipsEditor` (Task 12) already calls the route.

- [ ] **Step 1: Failing tests**

In `packages/db/test/credits.test.ts`, add inside the `priceFor` test:

```ts
    expect(priceFor("ai_chips", {})).toBe(1);
```

In `apps/worker/test/ai.test.ts`:
- Widen `queue`'s `type` parameter to `"ai_design" | "ai_translate" | "ai_copy" | "ai_chips" | "ai_reference"`.
- Add `runAiChips` to the `../src/ai/jobs.ts` import.
- Append:

```ts
describe("ai_chips (SP11)", () => {
  /** A Habit Tracker feature graphic whose chips already have a German translation. */
  async function chipsProject(s: Awaited<ReturnType<typeof setup>>) {
    const [t] = await db.select().from(schema.templates).where(eq(schema.templates.slug, "fg-habit-tracker"));
    const doc = migrate(t!.doc);
    doc.localization.locales = [{ code: "de-DE" }];
    doc.groups[0]!.boards[0]!.localized = { "de-DE": { "habit-chips": { chips: ["Tägliche Serien"], origin: "auto" } } };
    await db.update(schema.projects).set({ doc }).where(eq(schema.projects.id, s.project.id));
    return doc;
  }
  const chipsIn = (d: ChitrapxDoc) => (d.groups[0]!.boards[0]!.elements.find((e) => e.type === "chips") as unknown as { chips: string[] }).chips;

  it("replaces only the chips, drops their old translations and charges 1", async () => {
    const s = await setup(1);
    const before = await chipsProject(s);
    const { model, calls } = fakeModel(() => ({ features: ["Brew timer", "Recipes", "Bean log", "Recipes", "Grind guide", "A very long feature name"] }));
    const jobId = await queue(s.ws, s.project.id, "ai_chips", {}, 1);
    await runJob(jobId, (input, job) => runAiChips(input, job, deps(model)));

    expect(await jobRow(jobId)).toMatchObject({ status: "done", output: { chips: ["Brew timer", "Recipes", "Bean log", "Grind guide"] } });
    const out = (await projectRow(s.project.id)).doc as ChitrapxDoc;
    expect(chipsIn(out)).toEqual(["Brew timer", "Recipes", "Bean log", "Grind guide"]);
    const texts = (d: ChitrapxDoc) => d.groups[0]!.boards[0]!.elements.filter((e) => e.type === "text");
    expect(texts(out)).toEqual(texts(before));
    expect(out.groups[0]!.boards[0]!.localized?.["de-DE"]?.["habit-chips"]).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toContain("feature chips");
    expect(await balance(db, s.ws)).toBe(29);
  });

  it("fails and refunds when fewer than four usable chips come back", async () => {
    const s = await setup(1);
    const before = await chipsProject(s);
    const { model } = fakeModel(() => ({ features: ["One", "Two", "Three words here"] }));
    const jobId = await queue(s.ws, s.project.id, "ai_chips", {}, 1);
    await runJob(jobId, (input, job) => runAiChips(input, job, deps(model)));
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", error: "ai_incomplete" });
    expect(chipsIn((await projectRow(s.project.id)).doc as ChitrapxDoc)).toEqual(chipsIn(before));
    expect(await balance(db, s.ws)).toBe(30);
  });
});
```

Append inside the `describe` of `apps/worker/test/prompts.test.ts`. Add `chipsPrompt` to its import.

```ts
  it("the chips prompt carries the brief, what the screenshots show, the copy and the preset's example chips", () => {
    const insight = { summary: "Log a brew", feature: "Brew logging", uiElements: [], mood: "calm", dominantColors: [], textOnScreen: "" };
    const p = chipsPrompt({ ...app, preset: "health" }, [insight], [{ id: "h", text: "Brew better" }]);
    expect(p).toContain("Keywords: pour over, grinder");
    expect(p).toContain("- Brew logging: Log a brew");
    expect(p).toContain('"Brew better"');
    expect(p).toContain('Example chips for this vertical (style only): "Sleep tracking"');
  });
```

Append to `apps/web/test/ai.test.ts`:
- In `beforeAll`, change the queue list to `["ai_design", "ai_translate", "ai_copy", "ai_chips", "ai_reference"]`.
- Add `startChips` to the `@/server/ai.ts` import.

```ts
describe("chips (SP11)", () => {
  it("regenerating chips costs 1 credit and needs a chips element", async () => {
    const s = await setup(5);
    const plain = await createProject(s.ctx, s.app.id, { name: "P", templateSlug: "amoura-dating" });
    await expect(startChips(s.ctx, boss, plain.id)).rejects.toMatchObject({ code: "no_chips" });
    const fg = await createProject(s.ctx, s.app.id, { name: "F", templateSlug: "fg-habit-tracker" });
    await startChips(s.ctx, boss, fg.id);
    expect(await balance(db, s.ctx.workspaceId)).toBe(4);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @chitrapx/db exec vitest run test/credits.test.ts`
Expected: FAIL. `PRICES.ai_chips` is undefined.

- [ ] **Step 3: Price, schema, prompts**

In `packages/db/src/pricing.ts`, add to `PRICES` after `ai_copy`:

```ts
  /** SP11: new feature chips for a project (free when AI design writes them). */
  ai_chips: 1,
```

In `packages/db/src/credits.ts`, add `ai_chips: 600` to `EXPIRE_SECONDS`.

In `packages/document/src/ai.ts`, after `variantsSchema`, add:

```ts
/** SP11: the chips writer's answer, filtered by aiChips before use. */
export const chipsPlanSchema = z.object({ features: z.array(z.string()).describe("4 to 6 feature chips, most important first") });
```

In `apps/worker/src/ai/prompts.ts`, append:

```ts
export const CHIPS_SYSTEM = `You write the feature chips for a Google Play feature graphic: 4 to 6 short pills naming concrete features a shopper looks for, most important first. Each chip is one or two words and at most 16 characters. No duplicates, no end punctuation, no emoji, no claims such as "best" or "#1". Use the app's own vocabulary.`;

/** A preset's example chips, as style only. */
export function chipExamples(app: Pick<AppBrief, "preset">): string {
  const p = presetFor(app.preset);
  return p ? `\nExample chips for this vertical (style only): ${p.chips.map((c) => JSON.stringify(c)).join(", ")}` : "";
}

export function chipsPrompt(app: AppBrief, insights: ScreenInsight[], texts: SlotText[]): string {
  return `App: ${app.name}
Description: ${app.description || "(none)"}
Brief: ${app.brief || "(none)"}${verticalLines(app)}${chipExamples(app)}

What the screenshots show:
${insights.length ? insights.map((s) => `- ${s.feature}: ${s.summary}`).join("\n") : "(no screenshot notes)"}

Current screenshot copy:
${JSON.stringify(texts)}`;
}
```

- [ ] **Step 4: Worker job**

In `apps/worker/src/ai/jobs.ts`:
- Add `inArray` to the drizzle import.
- Add `aiChips`, `applyChips`, `CHIP_MIN`, `chipsPlanSchema` and `hasChips` to the document import.
- Add `CHIPS_SYSTEM` and `chipsPrompt` to the prompts import.
- Append:

```ts
/** New feature chips for the project's chips elements. Reads cached screenshot notes only: no vision calls. */
export async function runAiChips(_raw: unknown, job: JobContext, deps: AiDeps) {
  const { doc, app } = await projectDoc(job);
  if (!hasChips(doc)) throw new FatalJobError("no_chips");
  const shots = await db.select({ sha256: schema.assets.sha256 }).from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, job.workspaceId), eq(schema.assets.appId, app.id), eq(schema.assets.kind, "screenshot")))
    .orderBy(asc(schema.assets.createdAt)).limit(MAX_SCREENSHOTS);
  const cached = shots.length ? await db.select({ insight: schema.screenInsights.insight }).from(schema.screenInsights)
    .where(and(eq(schema.screenInsights.workspaceId, job.workspaceId), inArray(schema.screenInsights.sha256, shots.map((s) => s.sha256)))) : [];
  const insights = cached.flatMap((c) => { const p = screenInsightSchema.safeParse(c.insight); return p.success ? [p.data] : []; });
  const texts = allTexts(doc).filter((t) => t.text.trim() && !t.id.includes("#"));
  const { data, usage } = await deps.model.generate({
    model: MODELS.writer, system: CHIPS_SYSTEM, schema: chipsPlanSchema, effort: "low",
    content: [{ type: "text", text: chipsPrompt(appBrief(app), insights, texts) }],
  });
  const chips = aiChips(data.features);
  if (chips.length < CHIP_MIN) throw new FatalJobError("ai_incomplete");
  await updateProjectDoc(job, (current) => applyChips(current, chips));
  return { actual: PRICES.ai_chips, output: { chips, usage: sumUsage([usage]) } };
}
```

In `apps/worker/src/handlers.ts`, add `runAiChips` to the import and `ai_chips: (input, job) => runAiChips(input, job, aiDeps()),` to `handlers`.

- [ ] **Step 5: Web**

In `apps/web/src/server/ai.ts`, add `hasChips` to the document import and widen `enqueue`'s `type` to `"ai_design" | "ai_translate" | "ai_copy" | "ai_chips" | "ai_reference"`. Append:

```ts
/** New feature chips for the project (1 credit). Only projects that have a chips element. */
export async function startChips(ctx: Ctx, boss: PgBoss, projectId: string) {
  const project = await getProject(ctx, projectId);
  if (!hasChips(project.doc)) throw badRequest("no_chips");
  return enqueue(ctx, boss, project.id, "ai_chips", {});
}
```

`apps/web/src/app/api/projects/[projectId]/chips/route.ts`:

```ts
import { startChips } from "@/server/ai.ts";
import { getBoss } from "@/server/boss.ts";
import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";

export const POST = route(async (_req: Request, { params }: { params: Promise<{ projectId: string }> }) => {
  const ctx = await requireContext();
  return Response.json(await startChips(ctx, await getBoss(), (await params).projectId), { status: 201 });
});
```

In `apps/web/src/components/jobText.ts`, add `no_chips: "This project has no feature chips to regenerate.",` to `MESSAGES` and `ai_chips: "Feature chips"` to `JOB_LABEL`.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @chitrapx/db exec vitest run test/credits.test.ts && pnpm --filter @chitrapx/worker exec vitest run test/ai.test.ts test/prompts.test.ts && pnpm --filter @chitrapx/web exec vitest run test/ai.test.ts`
Expected: PASS.

- [ ] **Step 7: Browser check (needs `ANTHROPIC_API_KEY` and the worker: `pnpm --filter @chitrapx/worker dev`)**

Start the web dev server with the dev-server commands in Global Constraints. In a Habit Tracker project, select the chips and click "Regenerate chips (1 credit)". The editor is read-only while it runs. Then 4–6 new chips appear, the headline is unchanged, and the dashboard credit balance dropped by 1. Stop the server and the worker by PID.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: the only error is `billing.ts:61`.

```bash
git add packages/db packages/document apps/worker apps/web
git commit -m "feat(ai): regenerate a project's feature chips for 1 credit"
```

---

### Task 14: AI design adds a Google Play feature graphic with chips

**Files:**
- Modify: `packages/document/src/ai.ts` (`templateChoiceSchema`, `slotCopySchema`, `withFeatureGraphic`), `apps/worker/src/ai/prompts.ts` (`COPY_SYSTEM`, `pickPrompt`, `copyPrompt`), `apps/worker/src/ai/jobs.ts` (`runAiDesign`)
- Test: `packages/document/test/ai.test.ts` (append), `apps/worker/test/ai.test.ts` (modify `setup`, append), `apps/worker/test/prompts.test.ts` (append)

**Interfaces:**
- Produces:
  - `templateChoiceSchema.featureGraphicSlug?: string`
  - `slotCopySchema.features?: string[]`, `slotCopySchema.featureGraphic?: SlotText[]`
  - `withFeatureGraphic(doc, fgDoc, texts): ChitrapxDoc`: appends `fgDoc`'s `play-feature` group with ids prefixed `fg-` (group, boards, elements) and its copy written in. A no-op when `doc` already has a `play-feature` group.
  - `pickPrompt(app, insights, featureGraphics?: string[])`
  - `copyPrompt(app, insights, order, perBoard, slots, extra?: { featureGraphic?: TextSlot[]; features?: boolean })`
  - `runAiDesign` output gains `featureGraphicSlug?`
- Rule: when the app's `platformHint` is `android` or `both`, the candidates are the `play-feature-graphic` catalogue entries with a chips element. Fewer than 4 usable chips fails the job with `ai_incomplete`, refunded.

- [ ] **Step 1: Failing tests**

Append to `packages/document/test/ai.test.ts`. Add `applyChips` and `withFeatureGraphic` to its import.

```ts
describe("feature graphic for Play (SP11)", () => {
  const fg = () => doc([{ id: "fgx", target: "play-feature", spanElements: [], boards: [board("fb", [
    { ...text("t1", 0, 0), content: "Sample" } as never,
    { id: "c", type: "chips", chips: ["A", "B"], fontSize: 6, fontFamily: "Inter", color: "#fff", fillColor: "#000", position: { x: 0, y: 0 }, size: { width: 400, height: 90 }, rotation: 0, scale: 1 } as never,
  ], 1024, 500)] }]);

  it("appends the feature graphic size with prefixed ids and its own copy, once", () => {
    const out = withFeatureGraphic(tpl(), fg(), [{ id: "t1", text: "  Brew better  " }, { id: "ghost", text: "x" }]);
    const g = out.groups.at(-1)!;
    expect(g).toMatchObject({ id: "fg-fgx", target: "play-feature" });
    expect(g.boards[0]!.id).toBe("fg-fb");
    expect(g.boards[0]!.elements.map((e) => e.id)).toEqual(["fg-t1", "fg-c"]);
    expect((g.boards[0]!.elements[0] as unknown as { content: string }).content).toBe("Brew better");
    expect(withFeatureGraphic(out, fg(), [])).toBe(out);
    expect(applyChips(out, ["Timer", "Recipes", "Log", "Guide"]).groups.at(-1)!.boards[0]!.elements[1]).toMatchObject({ chips: ["Timer", "Recipes", "Log", "Guide"] });
  });
});
```

In `apps/worker/test/ai.test.ts`, change `setup` so existing tests keep an iOS app:

```ts
async function setup(screenshots = 3, credits = 30, platformHint: "ios" | "android" | "both" = "ios") {
```

and its app insert to `db.insert(schema.apps).values({ workspaceId: ws, name: "Bloom", description: "Coffee recipes", platformHint })`. Then append:

```ts
describe("AI design for Google Play (SP11)", () => {
  it("an app on Play also gets a feature graphic with 4 to 6 chips, its ids kept apart from the main set", async () => {
    const s = await setup(3, 30, "android");
    const slots = await amouraSlots();
    const { model, calls } = fakeModel((req) => {
      if (req.model === "claude-haiku-4-5") return insight;
      if (req.cachedContext) return { templateSlug: "amoura-dating", screenshotOrder: [0, 1, 2], reasoning: "fits", featureGraphicSlug: "fg-habit-tracker" };
      return {
        boards: slots.map((b, i) => ({ boardIndex: i, texts: b.map((x) => ({ id: x.id, text: `Copy ${i}` })) })),
        featureGraphic: [{ id: "t108", text: "Brew better" }, { id: "t109", text: "Recipes for every bean" }],
        features: ["Brew timer", "Recipes", "Bean log", "Brew timer", "Grind guide", "A very long feature name"],
      };
    });
    const jobId = await queue(s.ws, s.project.id, "ai_design", { appId: s.app.id }, 10);
    await runJob(jobId, (input, job) => runAiDesign(input, job, deps(model)));

    expect(await jobRow(jobId)).toMatchObject({ status: "done", output: { featureGraphicSlug: "fg-habit-tracker" } });
    const doc = (await projectRow(s.project.id)).doc as ChitrapxDoc;
    expect(doc.groups.map((g) => g.target)).toEqual(["iphone-6.9", "play-feature"]);
    const fg = doc.groups[1]!;
    expect(fg.id).toBe("fg-fg-habit-tracker-play-feature");
    expect(fg.boards[0]!.elements.every((e) => e.id.startsWith("fg-"))).toBe(true);
    expect((fg.boards[0]!.elements.find((e) => e.id === "fg-t108") as unknown as { content: string }).content).toBe("Brew better");
    expect((fg.boards[0]!.elements.find((e) => e.type === "chips") as unknown as { chips: string[] }).chips).toEqual(["Brew timer", "Recipes", "Bean log", "Grind guide"]);
    const pick = calls.find((c) => c.cachedContext)!;
    expect((pick.content[0] as { text: string }).text).toContain("fg-habit-tracker");
    const copy = calls.find((c) => c.model !== "claude-haiku-4-5" && !c.cachedContext)!;
    expect((copy.content[0] as { text: string }).text).toContain('id "t108"');
    expect(await balance(db, s.ws)).toBe(20);
  });

  it("an iOS-only app gets no feature graphic and is not asked for chips", async () => {
    const s = await setup(3);
    const slots = await amouraSlots();
    const { model, calls } = fakeModel((req) => (req.model === "claude-haiku-4-5" ? insight : req.cachedContext
      ? { templateSlug: "amoura-dating", screenshotOrder: [0, 1, 2], reasoning: "" }
      : { boards: slots.map((b, i) => ({ boardIndex: i, texts: b.map((x) => ({ id: x.id, text: `Copy ${i}` })) })) }));
    const jobId = await queue(s.ws, s.project.id, "ai_design", { appId: s.app.id }, 10);
    await runJob(jobId, (input, job) => runAiDesign(input, job, deps(model)));
    expect(((await projectRow(s.project.id)).doc as ChitrapxDoc).groups).toHaveLength(1);
    expect(calls.every((c) => !(c.content[0] as { text?: string }).text?.includes('"features"'))).toBe(true);
  });

  it("too few usable chips for a Play app fails and refunds", async () => {
    const s = await setup(2, 30, "both");
    const slots = await amouraSlots();
    const { model } = fakeModel((req) => (req.model === "claude-haiku-4-5" ? insight : req.cachedContext
      ? { templateSlug: "amoura-dating", screenshotOrder: [0, 1], reasoning: "" }
      : { boards: slots.map((b, i) => ({ boardIndex: i, texts: b.map((x) => ({ id: x.id, text: "ok" })) })), features: ["Timer"] }));
    const jobId = await queue(s.ws, s.project.id, "ai_design", { appId: s.app.id }, 10);
    await runJob(jobId, (input, job) => runAiDesign(input, job, deps(model)));
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", error: "ai_incomplete" });
    expect(await balance(db, s.ws)).toBe(30);
  });
});
```

Append inside the `describe` of `apps/worker/test/prompts.test.ts`:

```ts
  it("asks for a feature graphic and chips only when given them", () => {
    expect(pickPrompt(app, [], ["fg-habit-tracker", "fg-travel-explore"])).toContain("Choose featureGraphicSlug from these feature graphic templates: fg-habit-tracker, fg-travel-explore");
    expect(pickPrompt(app, [])).not.toContain("featureGraphicSlug");
    const slot = { id: "t108", role: "Text", text: "Build better habits", maxChars: 40 };
    const p = copyPrompt(app, [], [], [], [], { featureGraphic: [slot], features: true });
    expect(p).toContain('Google Play feature graphic (1024x500). Answer in "featureGraphic":\n  - id "t108"');
    expect(p).toContain('Also answer "features": 4 to 6 feature chips');
    expect(copyPrompt(app, [], [], [], [])).not.toContain('"features"');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @chitrapx/document exec vitest run test/ai.test.ts`
Expected: FAIL. `withFeatureGraphic` is not exported.

- [ ] **Step 3: Schemas and `withFeatureGraphic`**

In `packages/document/src/ai.ts`:
- Add `import type { Draft } from "immer";` and `type BoardGroup` to the `./doc.ts` import.
- Replace `templateChoiceSchema` and `slotCopySchema` with:

```ts
export const templateChoiceSchema = z.object({
  templateSlug: z.string(),
  screenshotOrder: z.array(z.number().int()).describe("Screenshot indices in the order they should appear, best first"),
  reasoning: z.string(),
  featureGraphicSlug: z.string().optional().describe("Only when asked: the Google Play feature graphic template slug"),
});
```

```ts
export const slotCopySchema = z.object({
  boards: z.array(z.object({ boardIndex: z.number().int(), texts: z.array(slotText) })),
  featureGraphic: z.array(slotText).optional().describe("Only when asked: text for the feature graphic's slots"),
  features: z.array(z.string()).optional().describe("Only when asked: 4 to 6 feature chips, most important first"),
});
```

and after `applyDesign`, add:

```ts
/**
 * SP11: appends the feature graphic template's size to `doc` with its copy written in. Every id is prefixed "fg-",
 * so they never meet the main template's ids (texts are translated by element id across sizes). No-op when the
 * document already has a feature graphic.
 */
export function withFeatureGraphic(doc: ChitrapxDoc, fg: ChitrapxDoc, texts: SlotText[]): ChitrapxDoc {
  const src = fg.groups.find((g) => g.target === "play-feature");
  if (!src || doc.groups.some((g) => g.target === "play-feature")) return doc;
  const byId = new Map(texts.map((t) => [t.id, t.text.trim()]));
  const copy = JSON.parse(JSON.stringify(src)) as BoardGroup;
  const group: BoardGroup = {
    ...copy, id: `fg-${copy.id}`, spanElements: [],
    boards: copy.boards.map(({ localized: _l, ...b }) => ({
      ...b, id: `fg-${b.id}`,
      elements: b.elements.map((e) => {
        const out = { ...e, id: `fg-${e.id}` } as ArtboardElement;
        const text = byId.get(e.id);
        if (text && out.type === "text") setContent(out as TextElementProps, text.slice(0, budget((out as TextElementProps).content ?? "")));
        return out;
      }),
    })),
  };
  return produce(doc, (d) => { d.groups.push(group as Draft<BoardGroup>); });
}
```

- [ ] **Step 4: Prompts**

In `apps/worker/src/ai/prompts.ts`, append this sentence to the end of `COPY_SYSTEM`'s text: ` When the request also lists a feature graphic or asks for feature chips, answer those too.`

Replace `pickPrompt` and `copyPrompt` with:

```ts
export function pickPrompt(app: AppBrief, insights: ScreenInsight[], featureGraphics: string[] = []): string {
  const colours = [app.brand.primaryColor, app.brand.secondaryColor].filter(Boolean).join(", ");
  const p = presetFor(app.preset);
  const suggested = !colours && p ? `\nSuggested colours for this vertical: ${Object.values(p.palette).join(", ")}` : "";
  const play = featureGraphics.length
    ? `\n\nThis app also ships on Google Play. Choose featureGraphicSlug from these feature graphic templates: ${featureGraphics.join(", ")}`
    : "";
  return `App: ${app.name} (${app.platform})
Description: ${app.description || "(none)"}
Brief from the team: ${app.brief || "(none)"}${verticalLines(app)}
Brand colours: ${colours || "(none)"}${suggested}

Screenshots, by index:
${insights.map((s, i) => `${i}. ${s.summary} Feature: ${s.feature}. Mood: ${s.mood}.`).join("\n")}${play}`;
}
```

```ts
/** `perBoard[i]` lists positions in `order` shown on board i (none, one, or several devices). */
export function copyPrompt(app: AppBrief, insights: ScreenInsight[], order: number[], perBoard: number[][], slots: TextSlot[][],
  extra: { featureGraphic?: TextSlot[]; features?: boolean } = {}): string {
  const fg = extra.featureGraphic?.length ? `\n\nGoogle Play feature graphic (1024x500). Answer in "featureGraphic":\n${extra.featureGraphic.map(slotLine).join("\n")}` : "";
  const chips = extra.features
    ? `\n\nAlso answer "features": 4 to 6 feature chips for the feature graphic, each one or two words and at most 16 characters, most important first, no duplicates.${chipExamples(app)}`
    : "";
  return `App: ${app.name}
Description: ${app.description || "(none)"}
Brief: ${app.brief || "(none)"}${verticalLines(app)}

Boards in order, with the screenshots each one shows.
${slots.map((board, i) => {
    const shots = (perBoard[i] ?? []).map((k) => insights[order[k] ?? -1]).filter((s): s is ScreenInsight => !!s);
    return `Board ${i}${shots.length ? ` shows: ${shots.map((s) => `${s.summary} (feature: ${s.feature})`).join("; ")}` : " shows no screenshot"}
${board.map(slotLine).join("\n")}`;
  }).join("\n\n")}${fg}${chips}`;
}
```

- [ ] **Step 5: The design job**

In `apps/worker/src/ai/jobs.ts`, add `withFeatureGraphic` to the document import, and replace `runAiDesign` with:

```ts
/** Screenshots in, finished screenshot set out: analyse, pick a template, write the copy, apply. Apps on Play also get a feature graphic with chips. */
export async function runAiDesign(raw: unknown, job: JobContext, deps: AiDeps) {
  const input = designInput.safeParse(raw);
  if (!input.success) throw new FatalJobError("invalid_input");
  const app = await loadApp(job, input.data.appId);
  const assets = (await db.select().from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, job.workspaceId), eq(schema.assets.appId, app.id), eq(schema.assets.kind, "screenshot")))
    .orderBy(asc(schema.assets.createdAt))).slice(0, MAX_SCREENSHOTS);
  if (!assets.length) throw new FatalJobError("no_screenshots");

  const usage: Usage[] = [];
  const insights = await insightsFor(job, assets, deps, usage);
  const brief = appBrief(app, { brief: input.data.brief, preset: input.data.preset });
  // Feature graphic candidates: only templates with a chips element, so the chips always have a home.
  const fgSlugs = app.platformHint === "ios" ? [] : catalog()
    .filter((c) => c.category === "play-feature-graphic" && c.boards.some((b) => (b.chips ?? 0) > 0)).map((c) => c.slug);

  const pick = await deps.model.generate({
    model: MODELS.writer, system: PICK_SYSTEM, cachedContext: catalogContext(catalog()), schema: templateChoiceSchema, effort: "medium",
    content: [{ type: "text", text: pickPrompt(brief, insights, fgSlugs) }],
  });
  usage.push(pick.usage);
  const [template] = await db.select().from(schema.templates)
    .where(and(eq(schema.templates.slug, pick.data.templateSlug), eq(schema.templates.kind, "screenshots")));
  if (!template) throw new FatalJobError("ai_unknown_template");
  const templateDoc = migrate(template.doc);
  const order = repairOrder(pick.data.screenshotOrder, assets.length);

  let fgDoc: ChitrapxDoc | null = null;
  let fgSlug: string | undefined;
  if (fgSlugs.length && !templateDoc.groups.some((g) => g.target === "play-feature")) {
    fgSlug = fgSlugs.includes(pick.data.featureGraphicSlug ?? "") ? pick.data.featureGraphicSlug! : fgSlugs[0]!;
    const [fg] = await db.select().from(schema.templates).where(and(eq(schema.templates.slug, fgSlug), eq(schema.templates.kind, "screenshots")));
    if (fg) fgDoc = migrate(fg.doc); else fgSlug = undefined;
  }
  const wantChips = !!fgDoc || hasChips(templateDoc);

  const copy = await deps.model.generate({
    model: MODELS.writer, system: COPY_SYSTEM, schema: slotCopySchema, effort: "medium",
    content: [{ type: "text", text: copyPrompt(brief, insights, order, screenshotsPerBoard(templateDoc, assets.length), textSlots(templateDoc),
      { featureGraphic: fgDoc ? textSlots(fgDoc)[0] : undefined, features: wantChips }) }],
  });
  usage.push(copy.usage);
  // Charging for a template full of sample copy would be wrong: most slots must be written.
  const slotIds = new Set(textSlots(templateDoc).flat().map((x) => x.id));
  const written = new Set(copy.data.boards.flatMap((b) => b.texts.map((x) => x.id)).filter((id) => slotIds.has(id)));
  if (slotIds.size && written.size < slotIds.size * MIN_COVERAGE) throw new FatalJobError("ai_incomplete");
  const chips = aiChips(copy.data.features ?? []);
  if (wantChips && chips.length < CHIP_MIN) throw new FatalJobError("ai_incomplete");

  let designed = applyDesign(templateDoc, { screenshotOrder: order, boards: copy.data.boards }, assets.map((a) => a.id));
  if (fgDoc) designed = withFeatureGraphic(designed, fgDoc, copy.data.featureGraphic ?? []);
  if (wantChips) designed = applyChips(designed, chips);
  await updateProjectDoc(job, () => ({ ...designed, brand: { appId: app.id } }));
  return { actual: PRICES.ai_design, output: { templateSlug: template.slug, featureGraphicSlug: fgSlug, reasoning: pick.data.reasoning, usage: sumUsage(usage) } };
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/worker exec vitest run test/ai.test.ts test/prompts.test.ts`
Expected: PASS, and every earlier `ai_design` test passes with the iOS `setup` default.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: the only error is `billing.ts:61`.

```bash
git add packages/document apps/worker
git commit -m "feat(ai): AI design adds a Google Play feature graphic with feature chips for apps on Play"
```

---

### Task 15: Competitor reference images: storage, limits and isolation

**Files:**
- Create: `apps/web/src/app/api/apps/[appId]/reference/route.ts` (GET), `apps/web/src/app/api/apps/[appId]/reference/[assetId]/route.ts` (DELETE)
- Modify:
  - `packages/document/src/ai.ts` (`MAX_REFERENCES_PER_APP`)
  - `packages/db/src/schema.ts` (`assetKindEnum`, `referenceInsights`)
  - `packages/db/src/assetCheck.ts`
  - `apps/web/src/server/uploads.ts` (reference kind, rights, limit, role conflict, `listAssets`, `listReferences`, `deleteReference`)
  - `apps/web/src/server/projects.ts` (`assetUrlMap`)
  - `apps/worker/src/bundle.ts`, `apps/web/src/lib/uploadAsset.ts`, `README.md`
- Generate: `packages/db/migrations/0011_*.sql` (plus the RLS lines below)
- Test: `apps/web/test/references.test.ts` (create), `packages/db/test/rls.test.ts` (modify), `apps/worker/test/bundle.test.ts` (append)

**Interfaces:**
- Produces:
  - `MAX_REFERENCES_PER_APP = 10` (from `@chitrapx/document`, so client code can use it without pulling in the DB package)
  - `AssetKind` gains `"reference"`; `schema.referenceInsights { id, workspaceId, assetId (unique, cascade), insight, model, createdAt }`
  - `signUpload(…, { kind: "reference", analysisRights: true, … })`
  - errors `analysis_rights_required` (400), `reference_limit` (409), `asset_kind_conflict` (409)
  - `listReferences(ctx, storage, appId): Array<Asset & { url: string; insight: unknown }>`
  - `deleteReference(ctx, storage, appId, assetId)`
  - `uploadAsset(appId, kind, file, opts?: { analysisRights?: boolean })`
- Invariants: `listAssets` and `assetUrlMap` never return a `reference` asset, and bundles never pack one.

- [ ] **Step 1: Failing tests**

`apps/web/test/references.test.ts`:

```ts
import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, schema } from "@chitrapx/db";
import type { ChitrapxDoc } from "@chitrapx/document";
import { memoryStorage } from "@chitrapx/storage";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { createApp } from "@/server/apps.ts";
import type { Ctx } from "@/server/context.ts";
import { assetUrlMap } from "@/server/projects.ts";
import { completeUpload, deleteReference, listAssets, listReferences, signUpload, stagingPath } from "@/server/uploads.ts";

/** A valid w x h RGB PNG built from stdlib only. */
function png(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc((w * 3 + 1) * h))), chunk("IEND", Buffer.alloc(0))]);
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const rights = { analysisRights: true };

async function setup() {
  const user = await createUser();
  const ctx: Ctx = { userId: user.id, workspaceId: await makeWorkspace(user.id, "pro"), plan: "pro" };
  return { ctx, app: await createApp(ctx, { name: "A" }), storage: memoryStorage() };
}
type S = Awaited<ReturnType<typeof setup>>;
async function upload(s: S, file: Buffer, kind: "screenshot" | "reference", extra: object = {}) {
  const signed = await signUpload(s.ctx, s.storage, { appId: s.app.id, kind, size: file.length, mime: "image/png", sha256: sha(file), ...extra });
  if ("existing" in signed) return signed.existing;
  await s.storage.put(stagingPath(s.ctx, signed.uploadId), file, "application/octet-stream");
  return completeUpload(s.ctx, s.storage, { appId: s.app.id, kind, sha256: sha(file), uploadId: signed.uploadId });
}
const imageDoc = (...ids: string[]) => ({ schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [] }, groups: [{ id: "g", target: "iphone-6.9", spanElements: [],
  boards: [{ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1,
    elements: ids.map((id, i) => ({ id: `i${i}`, type: "image", imageSrc: `asset:${id}`, position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, rotation: 0, scale: 1 })) }] }] }) as unknown as ChitrapxDoc;

describe("competitor reference images (SP11)", () => {
  it("need the analysis-rights box, and an app's board holds at most ten", async () => {
    const s = await setup();
    await expect(upload(s, png(2, 2), "reference")).rejects.toMatchObject({ status: 400, code: "analysis_rights_required" });
    for (let i = 1; i <= 10; i++) await upload(s, png(i, 1), "reference", rights);
    await expect(upload(s, png(11, 1), "reference", rights)).rejects.toMatchObject({ status: 409, code: "reference_limit" });
    expect(await upload(s, png(3, 1), "reference", rights)).toMatchObject({ kind: "reference" }); // the same image again is not a new one
  });

  it("never show up as app uploads, editor assets or document sources", async () => {
    const s = await setup();
    const ref = await upload(s, png(3, 3), "reference", rights);
    const shot = await upload(s, png(4, 4), "screenshot");
    expect((await listAssets(s.ctx, s.storage, s.app.id)).map((a) => a.id)).toEqual([shot.id]);
    expect((await listReferences(s.ctx, s.storage, s.app.id)).map((a) => [a.id, a.kind, a.insight])).toEqual([[ref.id, "reference", null]]);
    expect(Object.keys(await assetUrlMap(s.ctx, s.storage, imageDoc(ref.id, shot.id)))).toEqual([`asset:${shot.id}`]);
  });

  it("one file cannot be both a reference and an upload of the same app", async () => {
    const s = await setup();
    const file = png(5, 5);
    await upload(s, file, "screenshot");
    await expect(upload(s, file, "reference", rights)).rejects.toMatchObject({ status: 409, code: "asset_kind_conflict" });
  });

  it("a file another app already has becomes a reference here, not a screenshot", async () => {
    const s = await setup();
    const other = await createApp(s.ctx, { name: "Other" });
    const file = png(6, 6);
    await upload({ ...s, app: other }, file, "screenshot");
    expect(await upload(s, file, "reference", rights)).toMatchObject({ kind: "reference", appId: s.app.id });
  });

  it("deleting a reference deletes its analysis, and its bytes when nothing else uses them", async () => {
    const s = await setup();
    const ref = await upload(s, png(7, 7), "reference", rights);
    await db.insert(schema.referenceInsights).values({ workspaceId: s.ctx.workspaceId, assetId: ref.id, insight: { headline: "x" }, model: "m" });
    await deleteReference(s.ctx, s.storage, s.app.id, ref.id);
    expect(await db.select().from(schema.referenceInsights).where(eq(schema.referenceInsights.assetId, ref.id))).toEqual([]);
    expect(await s.storage.exists(`${s.ctx.workspaceId}/${ref.sha256}`)).toBe(false);
    await expect(deleteReference(s.ctx, s.storage, s.app.id, ref.id)).rejects.toMatchObject({ status: 404 });
  });
});
```

In `packages/db/test/rls.test.ts`:
- Change `type Ids` to `{ user: string; ws: string; app: string; project: string; ref2: string }`.
- At the end of `seedWorkspace`, before `return`, add:

```ts
  const refAsset = "insert into assets (workspace_id, app_id, kind, storage_path, mime, bytes, sha256) values ($1, $2, 'reference', 'p', 'image/png', 1, $3) returning id";
  const ref = (await pool.query(refAsset, [ws, app, randomUUID()])).rows[0].id;
  const ref2 = (await pool.query(refAsset, [ws, app, randomUUID()])).rows[0].id;
  await pool.query("insert into reference_insights (workspace_id, asset_id, insight, model) values ($1, $2, '{}', 'm')", [ws, ref]);
```

- Return `{ user, ws, app, project, ref2 }`.
- Add to `cases`:

```ts
  { table: "reference_insights", where: (b) => `workspace_id = '${b.ws}'`, set: "model = 'x'", insert: (b) => ["insert into reference_insights (workspace_id, asset_id, insight, model) values ($1, $2, '{}', 'm')", [b.ws, b.ref2]] },
```

Append inside `describe("project_bundle", ...)` of `apps/worker/test/bundle.test.ts`:

```ts
  it("never packs a competitor reference image: a document pointing at one fails as asset_missing", async () => {
    const p = await projectWithAsset();
    await db.update(schema.assets).set({ kind: "reference" }).where(eq(schema.assets.id, p.assetId));
    await runJob(p.jobId, (input, job) => runBundle(input, job, p.deps));
    const job = await jobRow(p.jobId);
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/^asset_missing/);
  });
```

- [ ] **Step 2: Schema and migration**

In `packages/document/src/ai.ts`, after `screenInsightSchema`, add:

```ts
/** SP11: competitor images per app's reference board; also the most `ai_reference` charges for at once. */
export const MAX_REFERENCES_PER_APP = 10;
```

In `packages/db/src/schema.ts`, change `assetKindEnum` to `pgEnum("asset_kind", ["screenshot", "recording", "image", "font", "export", "thumbnail", "reference"])` and after `screenInsights` add:

```ts
/**
 * SP11: one analysis per competitor reference image. Keyed by the asset, so deleting the image (or its app) deletes
 * the analysis, and nothing is shared across apps or workspaces.
 */
export const referenceInsights = pgTable("reference_insights", {
  id: id(),
  workspaceId: workspaceRef(),
  assetId: uuid("asset_id").notNull().unique().references(() => assets.id, { onDelete: "cascade" }),
  insight: jsonb("insight").notNull(),
  model: text("model").notNull(),
  createdAt: createdAt(),
});
```

Run: `pnpm --filter @chitrapx/db generate`
Expected: `packages/db/migrations/0011_<name>.sql` with `ALTER TYPE "public"."asset_kind" ADD VALUE 'reference';`, `CREATE TABLE "reference_insights" …` (with the unique `asset_id` and both foreign keys), and the snapshot and journal updates. Append to that SQL file:

```sql
--> statement-breakpoint
alter table reference_insights enable row level security;
--> statement-breakpoint
create policy reference_insights_read on reference_insights for select to authenticated using (is_member(workspace_id));
```

Run: `pnpm db:migrate`
Expected: exits 0.

- [ ] **Step 3: Uploads and isolation**

In `packages/db/src/assetCheck.ts`:
- Make `AssetKind` `"screenshot" | "image" | "recording" | "font" | "reference"`.
- Add `reference: 25 * MB` to `UPLOAD_LIMITS`, `reference: ["image/png", "image/jpeg", "image/webp"]` to `ACCEPTED`, and `reference: 512 * 1024` to `HEAD_BYTES`.

In `apps/web/src/server/uploads.ts`:
- Change the drizzle import to `import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";`.
- Add `import { MAX_REFERENCES_PER_APP } from "@chitrapx/document";`.
- Import `notFound` from `./http.ts`.
- Make `uploadKind` `z.enum(["screenshot", "image", "recording", "font", "reference"])`.
- Add `analysisRights: z.boolean().optional(),` to `signInput`.
- Replace `linkExisting` and the non-font parts of `signUpload` and `completeUpload`:

```ts
/** Adds an asset row for `appId` that reuses bytes this workspace already validated. A competitor reference keeps its own role. */
async function linkExisting(ctx: Ctx, appId: string, from: Asset, kind: UploadKind): Promise<Asset> {
  const { id: _id, createdAt: _c, ...copy } = from;
  const role = kind === "reference" || from.kind === "reference" ? { kind, meta: null } : {};
  await db.insert(schema.assets).values({ ...copy, appId, ...role }).onConflictDoNothing();
  return (await findAsset(ctx, from.sha256, appId))!;
}

/** One file is either on the competitor board or one of the app's own uploads, never both. */
function assertSameRole(existing: Asset, kind: UploadKind) {
  if ((existing.kind === "reference") === (kind === "reference")) return;
  throw new HttpError(409, "asset_kind_conflict", existing.kind === "reference" ? "This image is already on the competitor board" : "This image is already one of this app's uploads");
}

/** SP11: a competitor board holds at most ten images. */
async function assertReferenceRoom(ctx: Ctx, appId: string) {
  const [{ n }] = (await db.select({ n: count() }).from(schema.assets).where(and(
    eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.appId, appId), eq(schema.assets.kind, "reference"),
  ))) as [{ n: number }];
  if (n >= MAX_REFERENCES_PER_APP) throw new HttpError(409, "reference_limit", `A competitor board holds up to ${MAX_REFERENCES_PER_APP} images`);
}

export async function signUpload(ctx: Ctx, storage: ObjectStorage, raw: unknown):
  Promise<{ existing: Asset } | { uploadId: string; url: string; headers: Record<string, string> }> {
  const input = signInput.parse(raw);
  if (input.kind === "font") return signFont(ctx, storage, input);
  if (!input.appId) throw badRequest("app_required");
  const appId = input.appId;
  await getApp(ctx, appId);
  if (input.kind === "reference" && input.analysisRights !== true) {
    throw new HttpError(400, "analysis_rights_required", "Confirm you have the right to analyse these images");
  }
  if (input.size > UPLOAD_LIMITS[input.kind]) throw tooLarge(input.kind);
  if (!ACCEPTED[input.kind].includes(input.mime)) throw badRequest("unsupported_type");

  const mine = await findAsset(ctx, input.sha256, appId);
  if (mine) { assertSameRole(mine, input.kind); return { existing: mine }; }
  if (input.kind === "reference") await assertReferenceRoom(ctx, appId);
  const sibling = await findAsset(ctx, input.sha256);
  if (sibling) return { existing: await linkExisting(ctx, appId, sibling, input.kind) };

  const uploadId = randomUUID();
  return { uploadId, ...(await storage.presignPut(stagingPath(ctx, uploadId), { contentType: input.mime, contentLength: input.size })) };
}
```

In `completeUpload`:
- Replace `if (mine) { await discard(); return mine; }` with `if (mine) { await discard(); assertSameRole(mine, input.kind); return mine; }`.
- After it, add `if (input.kind === "reference") await assertReferenceRoom(ctx, appId).catch(async (err) => { await discard(); throw err; });`.
- Change the sibling line to `if (sibling) { await discard(); return linkExisting(ctx, appId, sibling, input.kind); }`.

In `listAssets`, add `ne(schema.assets.kind, "reference")` to the `where(and(...))`, and append:

```ts
/** The app's competitor board: signed image URLs and each image's analysis (null until analysed). */
export async function listReferences(ctx: Ctx, storage: ObjectStorage, appId: string): Promise<Array<Asset & { url: string; insight: unknown }>> {
  await getApp(ctx, appId);
  const rows = await db.select({ asset: schema.assets, insight: schema.referenceInsights.insight }).from(schema.assets)
    .leftJoin(schema.referenceInsights, eq(schema.referenceInsights.assetId, schema.assets.id))
    .where(and(eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.appId, appId), eq(schema.assets.kind, "reference")))
    .orderBy(asc(schema.assets.createdAt));
  const urls = await storage.signedUrls(rows.map((r) => finalPath(ctx, r.asset.sha256)));
  return rows.map((r, i) => ({ ...r.asset, url: urls[i] ?? "", insight: r.insight ?? null }));
}

/** Removes one competitor image. Its analysis goes with the row (on delete cascade); its bytes go too unless another row uses them. */
export async function deleteReference(ctx: Ctx, storage: ObjectStorage, appId: string, assetId: string): Promise<void> {
  await getApp(ctx, appId);
  if (!z.uuid().safeParse(assetId).success) throw notFound();
  const [gone] = await db.delete(schema.assets).where(and(eq(schema.assets.id, assetId), eq(schema.assets.workspaceId, ctx.workspaceId),
    eq(schema.assets.appId, appId), eq(schema.assets.kind, "reference"))).returning();
  if (!gone) throw notFound();
  const [still] = await db.select({ id: schema.assets.id }).from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.sha256, gone.sha256))).limit(1);
  if (!still) await storage.remove(finalPath(ctx, gone.sha256)).catch(() => {});
}
```

In `apps/web/src/server/projects.ts`, add `ne` to the drizzle import and change the `assetUrlMap` query's `where` to `and(eq(schema.assets.workspaceId, ctx.workspaceId), inArray(schema.assets.id, ids), ne(schema.assets.kind, "reference"))`. Competitor images are never document sources.

In `apps/worker/src/bundle.ts`, add `ne` to the drizzle import and change the doc assets query's `where` to `and(eq(schema.assets.workspaceId, job.workspaceId), inArray(schema.assets.id, ids), ne(schema.assets.kind, "reference"))`.

`apps/web/src/app/api/apps/[appId]/reference/route.ts`:

```ts
import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { appStorage } from "@/server/storage.ts";
import { listReferences } from "@/server/uploads.ts";

type P = { params: Promise<{ appId: string }> };

export const GET = route(async (_req: Request, { params }: P) => listReferences(await requireContext(), appStorage(), (await params).appId));
```

`apps/web/src/app/api/apps/[appId]/reference/[assetId]/route.ts`:

```ts
import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { appStorage } from "@/server/storage.ts";
import { deleteReference } from "@/server/uploads.ts";

export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ appId: string; assetId: string }> }) => {
  const { appId, assetId } = await params;
  await deleteReference(await requireContext(), appStorage(), appId, assetId);
});
```

In `apps/web/src/lib/uploadAsset.ts`, change `uploadAsset`'s signature to `uploadAsset(appId: string, kind: "screenshot" | "recording" | "reference", file: File, opts: { analysisRights?: boolean } = {})` and its sign body to `{ appId, kind, size: file.size, mime: file.type, sha256, ...opts }`.

In `README.md`, after the SP8 deploy line, add:

```md
**SP11 (localization and AI copy)** adds migrations 0010 (app brief, glossary) and 0011 (competitor reference images). Run `pnpm db:migrate`, then deploy the worker (it handles the new `ai_chips` and `ai_reference` jobs), then web.
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @chitrapx/db test && pnpm --filter @chitrapx/web exec vitest run test/references.test.ts test/uploads.test.ts && pnpm --filter @chitrapx/worker exec vitest run test/bundle.test.ts`
Expected: PASS, the existing upload tests included.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: the only error is `billing.ts:61`.

```bash
git add packages/document packages/db apps/web apps/worker README.md
git commit -m "feat(uploads): competitor reference images with a rights check, a ten-image board and no way into projects or exports"
```

---

### Task 16: Competitor analysis (`ai_reference`) and competitor notes in every prompt

**Files:**
- Modify:
  - `packages/db/src/pricing.ts` (`ai_reference`, `priceFor`), `packages/db/src/credits.ts` (`EXPIRE_SECONDS`)
  - `packages/document/src/ai.ts` (`competitorInsightSchema`, `competitorSummarySchema`, `competitorEchoes`), `packages/document/src/brief.ts` (`competitor`)
  - `apps/worker/src/ai/prompts.ts` (`AppBrief.competitor`, `competitorLines`, `COMPETITOR_SYSTEM`, `COMPETITOR_SUMMARY_SYSTEM`, `competitorSummaryPrompt`, the four prompts), `apps/worker/src/ai/jobs.ts` (`runAiReference`, echo guard in `runAiDesign`), `apps/worker/src/handlers.ts`
  - `apps/web/src/server/ai.ts` (`startReferenceAnalysis`), `apps/web/src/server/jobs.ts` (`FREE_JOBS`), `apps/web/src/app/api/apps/[appId]/reference/route.ts` (POST), `apps/web/src/components/jobText.ts`
- Test: `packages/db/test/credits.test.ts`, `packages/document/test/ai.test.ts`, `apps/worker/test/ai.test.ts`, `apps/worker/test/prompts.test.ts`, `apps/web/test/ai.test.ts` (all append)

**Interfaces:**
- Produces:
  - `PRICES.ai_reference = 1`; `priceFor("ai_reference", { uncached })` = `min(10, uncached.length)`
  - `competitorInsightSchema { headline, benefit, layout, colourMood, differentiate }`, `type CompetitorInsight`, `competitorSummarySchema { summary }`
  - `competitorEchoes(text, headlines): boolean`
  - `briefSchema.competitor` (max 3000)
  - `AppBrief.competitor?`
  - `runAiReference(raw, job, deps)`, with input `{ appId, uncached: uuid[] }` and output `{ analysed, cached, summary, usage }`
  - `startReferenceAnalysis(ctx, boss, appId)` (error `no_references`; counts toward `FREE_JOBS`)
  - `POST /api/apps/[appId]/reference` → `{ jobId }` (201)
- Rule: the summary prompt never contains competitor headlines. Copy prompts get the summary only. Design copy that repeats a competitor headline of 3 or more words is dropped before it is applied.

- [ ] **Step 1: Failing tests**

In `packages/db/test/credits.test.ts`, add inside the `priceFor` test:

```ts
    expect(priceFor("ai_reference", { uncached: ["a", "b", "c"] })).toBe(3);
    expect(priceFor("ai_reference", { uncached: Array.from({ length: 14 }, (_, i) => `${i}`) })).toBe(10);
    expect(priceFor("ai_reference", { uncached: [] })).toBe(0);
```

Append to `packages/document/test/ai.test.ts`. Add `competitorEchoes` to its import.

```ts
it("competitorEchoes catches a repeated headline of three or more words, case and punctuation aside", () => {
  expect(competitorEchoes("Track every habit you have!", ["track every habit you have"])).toBe(true);
  expect(competitorEchoes("Build habits that stick", ["Track every habit you have"])).toBe(false);
  expect(competitorEchoes("Fast. Private.", ["Fast"])).toBe(false);
});
```

Append to `apps/worker/test/ai.test.ts`. Add `runAiReference` to the jobs import.

```ts
describe("ai_reference (SP11)", () => {
  const competitor = { headline: "Track every habit you have", benefit: "Never miss a day", layout: "Phone centred under a big headline", colourMood: "Bright teal", differentiate: "Nobody shows weekly reviews" };
  async function references(s: Awaited<ReturnType<typeof setup>>, n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const hash = crypto.randomUUID().replace(/-/g, "").padEnd(64, "r");
      const [a] = await db.insert(schema.assets).values({ workspaceId: s.ws, appId: s.app.id, kind: "reference", storagePath: `${s.ws}/${hash}`, mime: "image/png", bytes: png.length, sha256: hash }).returning();
      ids.push(a!.id);
    }
    return ids;
  }
  const answer = (req: StructuredRequest<unknown>) => (req.model === "claude-haiku-4-5" ? competitor : { summary: "Rivals lead with streaks; stand apart with weekly reviews." });

  it("charges once per new image, caches it, writes the summary into the brief, and re-runs free", async () => {
    const s = await setup(0);
    const ids = await references(s, 3);
    const first = fakeModel(answer);
    const jobId = await queue(s.ws, s.project.id, "ai_reference", { appId: s.app.id, uncached: ids }, 3);
    await runJob(jobId, (input, job) => runAiReference(input, job, deps(first.model)));
    expect(await jobRow(jobId)).toMatchObject({ status: "done", output: { analysed: 3, cached: 0 } });
    expect(await balance(db, s.ws)).toBe(27);
    expect(await db.select().from(schema.referenceInsights).where(eq(schema.referenceInsights.workspaceId, s.ws))).toHaveLength(3);
    const [app] = await db.select().from(schema.apps).where(eq(schema.apps.id, s.app.id));
    expect(app!.brief.competitor).toBe("Rivals lead with streaks; stand apart with weekly reviews.");
    const summaryCall = first.calls.find((c) => c.model !== "claude-haiku-4-5")!;
    expect((summaryCall.content[0] as { text: string }).text).not.toContain(competitor.headline);
    expect((summaryCall.content[0] as { text: string }).text).toContain("Nobody shows weekly reviews");

    const again = fakeModel(answer);
    const job2 = await queue(s.ws, s.project.id, "ai_reference", { appId: s.app.id, uncached: [] }, 0);
    await runJob(job2, (input, job) => runAiReference(input, job, deps(again.model)));
    expect(await jobRow(job2)).toMatchObject({ status: "done", output: { analysed: 0, cached: 3 } });
    expect(again.calls.filter((c) => c.model === "claude-haiku-4-5")).toHaveLength(0);
    expect(await balance(db, s.ws)).toBe(27);
  });

  it("an AI design reads the competitor notes, never sees their headlines, and drops copy that repeats one", async () => {
    const s = await setup(3);
    const [ref] = await references(s, 1);
    await db.insert(schema.referenceInsights).values({ workspaceId: s.ws, assetId: ref!, insight: competitor, model: "m" });
    await db.update(schema.apps).set({ brief: { competitor: "Rivals lead with streaks." } }).where(eq(schema.apps.id, s.app.id));
    const slots = await amouraSlots();
    const { model, calls } = fakeModel((req) => {
      if (req.model === "claude-haiku-4-5") return insight;
      if (req.cachedContext) return { templateSlug: "amoura-dating", screenshotOrder: [0, 1, 2], reasoning: "" };
      return { boards: slots.map((b, i) => ({ boardIndex: i, texts: b.map((x, k) => ({ id: x.id, text: i === 0 && k === 0 ? "Track every habit you have" : `Copy ${i}` })) })) };
    });
    const jobId = await queue(s.ws, s.project.id, "ai_design", { appId: s.app.id }, 10);
    await runJob(jobId, (input, job) => runAiDesign(input, job, deps(model)));
    expect((await jobRow(jobId)).status).toBe("done");
    const copyText = (calls.find((c) => c.model !== "claude-haiku-4-5" && !c.cachedContext)!.content[0] as { text: string }).text;
    expect(copyText).toContain("Competitor notes");
    expect(copyText).toContain("Rivals lead with streaks.");
    expect(copyText).not.toContain(competitor.headline);
    const first = ((await projectRow(s.project.id)).doc as ChitrapxDoc).groups[0]!.boards[0]!.elements.find((e) => e.id === slots[0]![0]!.id) as unknown as { content: string };
    expect(first.content).not.toBe("Track every habit you have");
  });
});
```

Add `type StructuredRequest` to the `../src/ai/model.ts` import if it is not already imported.

Append inside the `describe` of `apps/worker/test/prompts.test.ts`:

```ts
  it("competitor notes reach pick, copy, variants and chips as a labelled section, and are absent without them", () => {
    const withNotes = { ...app, competitor: "Rivals lead with streaks." };
    for (const p of [pickPrompt(withNotes, []), copyPrompt(withNotes, [], [], [], []), variantsPrompt(withNotes, []), chipsPrompt(withNotes, [], [])]) {
      expect(p).toContain("Competitor notes (from screenshots the team uploaded; stand apart, never reuse their wording):\nRivals lead with streaks.");
    }
    expect(pickPrompt(app, [])).not.toContain("Competitor notes");
  });
```

Append to `apps/web/test/ai.test.ts`. Add `startReferenceAnalysis` to the `@/server/ai.ts` import.

```ts
describe("competitor analysis (SP11)", () => {
  async function references(s: Awaited<ReturnType<typeof setup>>, n: number, analysed: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const hash = crypto.randomUUID().replace(/-/g, "").padEnd(64, "r");
      const [a] = await db.insert(schema.assets).values({ workspaceId: s.ctx.workspaceId, appId: s.app.id, kind: "reference", storagePath: "p", mime: "image/png", bytes: 1, sha256: hash }).returning();
      ids.push(a!.id);
      if (i < analysed) await db.insert(schema.referenceInsights).values({ workspaceId: s.ctx.workspaceId, assetId: a!.id, insight: {}, model: "m" });
    }
    return ids;
  }
  const inputOf = async (jobId: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)))[0]!.input;

  it("charges one credit per image not yet analysed; nothing on the board is refused", async () => {
    const s = await setup(5, 0);
    await expect(startReferenceAnalysis(s.ctx, boss, s.app.id)).rejects.toMatchObject({ code: "no_references" });
    const ids = await references(s, 3, 1);
    const { jobId } = await startReferenceAnalysis(s.ctx, boss, s.app.id);
    expect(await inputOf(jobId)).toEqual({ appId: s.app.id, uncached: [ids[1], ids[2]] });
    expect(await balance(db, s.ctx.workspaceId)).toBe(3);
  });

  it("a run with everything analysed is free but counts toward the hourly free allowance", async () => {
    const s = await setup(0, 0);
    await references(s, 1, 1);
    await startReferenceAnalysis(s.ctx, boss, s.app.id);
    expect(await balance(db, s.ctx.workspaceId)).toBe(0);
    for (let i = 0; i < 29; i++) await db.insert(schema.jobs).values({ workspaceId: s.ctx.workspaceId, type: "export_single", creditsReserved: 0 });
    await expect(startReferenceAnalysis(s.ctx, boss, s.app.id)).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @chitrapx/db exec vitest run test/credits.test.ts && pnpm --filter @chitrapx/document exec vitest run test/ai.test.ts`
Expected: FAIL. `ai_reference` is not a price and `competitorEchoes` is not exported.

- [ ] **Step 3: Price, schemas, brief field**

In `packages/db/src/pricing.ts`:
- Add `import { MAX_REFERENCES_PER_APP } from "@chitrapx/document";`.
- Add to `PRICES` after `ai_chips`:

```ts
  /** SP11: per competitor image not yet analysed (at most MAX_REFERENCES_PER_APP per run). Cached images are free. */
  ai_reference: 1,
```

- In `priceFor`, before `return PRICES[type];`, add:

```ts
  if (type === "ai_reference") {
    const uncached = (input as { uncached?: unknown[] } | null)?.uncached;
    return PRICES.ai_reference * Math.min(MAX_REFERENCES_PER_APP, Array.isArray(uncached) ? uncached.length : 0);
  }
```

In `packages/db/src/credits.ts`, add `ai_reference: 900` to `EXPIRE_SECONDS`.

In `packages/document/src/ai.ts`, after `MAX_REFERENCES_PER_APP`, add:

```ts
export const competitorInsightSchema = z.object({
  headline: z.string().describe("The screenshot's headline, verbatim"),
  benefit: z.string().describe("The benefit it claims, in a few words"),
  layout: z.string().describe("The layout pattern: device placement, text position, decoration"),
  colourMood: z.string().describe("Colour mood in a few words"),
  differentiate: z.string().describe("What a rival app could say or show differently or better"),
});
export type CompetitorInsight = z.infer<typeof competitorInsightSchema>;
export const competitorSummarySchema = z.object({ summary: z.string().describe("3 to 6 plain sentences: the competitive angle") });

const words = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** True when `text` repeats a competitor headline of three or more words, case, spacing and punctuation aside. */
export function competitorEchoes(text: string, headlines: string[]): boolean {
  const t = ` ${words(text)} `;
  return headlines.some((h) => { const n = words(h); return n.split(" ").length >= 3 && t.includes(` ${n} `); });
}
```

In `packages/document/src/brief.ts`, add to `briefSchema`:

```ts
  competitor: z.string().trim().max(3000, "Keep the competitor notes under 3000 characters").optional(),
```

- [ ] **Step 4: Prompts**

In `apps/worker/src/ai/prompts.ts`:
- Import `type CompetitorInsight` from `@chitrapx/document`.
- Add `/** SP11: the editable summary of the competitor board; never their headlines. */ competitor?: string;` to `AppBrief`.
- In `appBrief`'s returned object, add `competitor: app.brief.competitor?.trim() || undefined,`.
- Add:

```ts
/** The competitor board's summary as a labelled section. Empty without one. */
export const competitorLines = (app: Pick<AppBrief, "competitor">) => app.competitor?.trim()
  ? `\nCompetitor notes (from screenshots the team uploaded; stand apart, never reuse their wording):\n${app.competitor.trim()}`
  : "";

export const COMPETITOR_SYSTEM = `You look at one screenshot from a competing app's store listing and describe it for a team positioning their own app. Quote the headline exactly as printed. Be specific and factual; do not guess at features that are not visible.`;

export const COMPETITOR_SUMMARY_SYSTEM = `You turn notes on competitors' store screenshots into one competitive angle for a team writing their own screenshots: the messaging angles competitors lean on, the layouts that repeat, and two or three specific ways to stand apart. Write 3 to 6 plain sentences. Never quote a competitor or reuse their phrases.`;

/** Everything but the headlines, so the summary cannot quote one. */
export function competitorSummaryPrompt(appName: string, insights: CompetitorInsight[]): string {
  return `Our app: ${appName}
Competitor screenshots:
${insights.map((c, i) => `${i + 1}. Claims: ${c.benefit}. Layout: ${c.layout}. Mood: ${c.colourMood}. Gap: ${c.differentiate}.`).join("\n")}`;
}
```

Then add `${competitorLines(app)}` to the four prompts:
- In `pickPrompt`, right after `${verticalLines(app)}` on the "Brief from the team" line.
- In `copyPrompt` and `chipsPrompt`, right after `${verticalLines(app)}` on the "Brief" line.
- In `variantsPrompt`, change the type to `Pick<AppBrief, "name" | "brief" | "competitor">` and the text to `` `App: ${app.name}\nBrief: ${app.brief || "(none)"}${competitorLines(app)}\nCurrent copy (id and text):\n${JSON.stringify(texts)}` ``.

- [ ] **Step 5: Worker**

In `apps/worker/src/ai/jobs.ts`:
- Add `sql` to the drizzle import.
- Add `competitorEchoes`, `competitorInsightSchema`, `competitorSummarySchema`, `MAX_REFERENCES_PER_APP` and `type CompetitorInsight` to the document import.
- Add `COMPETITOR_SUMMARY_SYSTEM`, `COMPETITOR_SYSTEM` and `competitorSummaryPrompt` to the prompts import.
- Append:

```ts
/** Headlines of the app's analysed competitor images, which design copy must never repeat. */
async function competitorHeadlines(job: JobContext, appId: string): Promise<string[]> {
  const rows = await db.select({ insight: schema.referenceInsights.insight }).from(schema.referenceInsights)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.referenceInsights.assetId))
    .where(and(eq(schema.referenceInsights.workspaceId, job.workspaceId), eq(schema.assets.appId, appId)));
  return rows.flatMap((r) => { const p = competitorInsightSchema.safeParse(r.insight); return p.success ? [p.data.headline] : []; });
}

const referenceInput = z.object({ appId: z.uuid(), uncached: z.array(z.uuid()).max(MAX_REFERENCES_PER_APP).default([]) });

/** Analyses each competitor image once (cached per image), then writes one competitive angle into the app's brief. */
export async function runAiReference(raw: unknown, job: JobContext, deps: AiDeps) {
  const input = referenceInput.safeParse(raw);
  if (!input.success) throw new FatalJobError("invalid_input");
  const app = await loadApp(job, input.data.appId);
  const refs = await db.select({ asset: schema.assets, insight: schema.referenceInsights.insight }).from(schema.assets)
    .leftJoin(schema.referenceInsights, eq(schema.referenceInsights.assetId, schema.assets.id))
    .where(and(eq(schema.assets.workspaceId, job.workspaceId), eq(schema.assets.appId, app.id), eq(schema.assets.kind, "reference")))
    .orderBy(asc(schema.assets.createdAt)).limit(MAX_REFERENCES_PER_APP);
  if (!refs.length) throw new FatalJobError("no_references");
  // Only images this job was paid for are analysed; one uploaded after it was queued waits for the next run.
  const paid = new Set(input.data.uncached);
  const usage: Usage[] = [];
  const insights: CompetitorInsight[] = [];
  let analysed = 0;
  for (const r of refs) {
    const cached = competitorInsightSchema.safeParse(r.insight);
    if (cached.success) { insights.push(cached.data); continue; }
    if (!paid.has(r.asset.id)) continue;
    const image = await imageBlock(await deps.loadAsset(job.workspaceId, r.asset.sha256));
    const { data, usage: u } = await deps.model.generate({
      model: MODELS.fast, system: COMPETITOR_SYSTEM, schema: competitorInsightSchema, maxTokens: 2000,
      content: [image, { type: "text", text: "Describe this competitor screenshot." }],
    });
    usage.push(u);
    analysed++;
    await db.insert(schema.referenceInsights).values({ workspaceId: job.workspaceId, assetId: r.asset.id, insight: data, model: u.model })
      .onConflictDoUpdate({ target: schema.referenceInsights.assetId, set: { insight: data, model: u.model } });
    insights.push(data);
  }
  if (!insights.length) throw new FatalJobError("ai_incomplete");
  const { data: sum, usage: su } = await deps.model.generate({
    model: MODELS.writer, system: COMPETITOR_SUMMARY_SYSTEM, schema: competitorSummarySchema, effort: "low",
    content: [{ type: "text", text: competitorSummaryPrompt(app.name, insights) }],
  });
  usage.push(su);
  const summary = sum.summary.trim().slice(0, 3000);
  await db.execute(sql`update apps set brief = brief || jsonb_build_object('competitor', ${summary}::text) where id = ${app.id} and workspace_id = ${job.workspaceId}`);
  return { actual: PRICES.ai_reference * analysed, output: { analysed, cached: insights.length - analysed, summary, usage: sumUsage(usage) } };
}
```

In `runAiDesign`, replace the two lines from `const slotIds = …` through `const written = …` with:

```ts
  // Copy that repeats a competitor's headline is dropped; it then counts as unwritten.
  const headlines = await competitorHeadlines(job, app.id);
  const boards = copy.data.boards.map((b) => ({ ...b, texts: b.texts.filter((t) => !competitorEchoes(t.text, headlines)) }));
  const slotIds = new Set(textSlots(templateDoc).flat().map((x) => x.id));
  const written = new Set(boards.flatMap((b) => b.texts.map((x) => x.id)).filter((id) => slotIds.has(id)));
```

and pass `boards` instead of `copy.data.boards` to `applyDesign`.

In `apps/worker/src/handlers.ts`, add `runAiReference` to the import and `ai_reference: (input, job) => runAiReference(input, job, aiDeps()),` to `handlers`.

- [ ] **Step 6: Web**

In `apps/web/src/server/jobs.ts`, change `FREE_JOBS` to `["export_single", "project_bundle", "project_import", "ai_reference"]`. Paid competitor runs count too, which is harmless at 30 an hour.

In `apps/web/src/server/ai.ts`:
- Add `asc` to the drizzle import.
- Add `MAX_REFERENCES_PER_APP` to the document import.
- Add `import { assertFreeQuota } from "./jobs.ts";`.
- Append:

```ts
/** Analyses the app's competitor board: 1 credit per image not yet analysed; a run with nothing new is free but rate-limited. */
export async function startReferenceAnalysis(ctx: Ctx, boss: PgBoss, appId: string) {
  const app = await getApp(ctx, appId);
  const refs = await db.select({ id: schema.assets.id, insight: schema.referenceInsights.id }).from(schema.assets)
    .leftJoin(schema.referenceInsights, eq(schema.referenceInsights.assetId, schema.assets.id))
    .where(and(eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.appId, app.id), eq(schema.assets.kind, "reference")))
    .orderBy(asc(schema.assets.createdAt)).limit(MAX_REFERENCES_PER_APP);
  if (!refs.length) throw badRequest("no_references");
  const uncached = refs.filter((r) => !r.insight).map((r) => r.id);
  return withTx(async (tx) => {
    await assertFreeQuota(tx, ctx.workspaceId);
    return reserveAndEnqueue(tx, boss, { workspaceId: ctx.workspaceId, type: "ai_reference", input: { appId: app.id, uncached } });
  });
}
```

In `apps/web/src/app/api/apps/[appId]/reference/route.ts`, add:

```ts
import { startReferenceAnalysis } from "@/server/ai.ts";
import { getBoss } from "@/server/boss.ts";

export const POST = route(async (_req: Request, { params }: P) =>
  Response.json(await startReferenceAnalysis(await requireContext(), await getBoss(), (await params).appId), { status: 201 }));
```

In `apps/web/src/components/jobText.ts`, add `no_references: "Upload competitor screenshots to the board first.",` to `MESSAGES` and `ai_reference: "Competitor analysis"` to `JOB_LABEL`.

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @chitrapx/db exec vitest run test/credits.test.ts && pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/worker exec vitest run test/ai.test.ts test/prompts.test.ts && pnpm --filter @chitrapx/web exec vitest run test/ai.test.ts test/apps.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: the only error is `billing.ts:61`.

```bash
git add packages/db packages/document apps/worker apps/web
git commit -m "feat(ai): competitor analysis charged per new image, its summary in every prompt, echoed headlines dropped"
```

---

### Task 17: The competitor reference board

**Files:**
- Create: `apps/web/src/components/referenceModel.ts`, `apps/web/src/components/ReferenceBoard.tsx`
- Modify: `apps/web/src/app/dashboard/apps/[appId]/page.tsx`, `apps/web/src/components/AiDesignCard.tsx` (competitor note)
- Test: `apps/web/test/referenceModel.test.ts` (create)

**Interfaces:**
- Consumes:
  - `listReferences`, `DELETE /api/apps/[appId]/reference/[assetId]` (Task 15)
  - `POST /api/apps/[appId]/reference`, `competitorInsightSchema`, `brief.competitor` (Task 16)
  - `followJob` (Task 7), `uploadAsset(…, "reference", file, { analysisRights: true })` (Task 15)
- Produces:
  - `type ReferenceRow = { id; url; insight: unknown }`
  - `insightOf(raw)`, `analyseCost(rows)`, `slotsLeft(rows)`, `analyseLabel(rows)`
  - `ReferenceBoard({ appId, rows, summary })`

- [ ] **Step 1: Failing test**

`apps/web/test/referenceModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { analyseCost, analyseLabel, insightOf, slotsLeft } from "@/components/referenceModel.ts";

const done = { headline: "H", benefit: "B", layout: "L", colourMood: "M", differentiate: "D" };
const rows = (analysed: number, fresh: number) => [
  ...Array.from({ length: analysed }, (_, i) => ({ id: `a${i}`, url: "", insight: done })),
  ...Array.from({ length: fresh }, (_, i) => ({ id: `f${i}`, url: "", insight: null })),
];

describe("reference board model", () => {
  it("costs one credit per image not yet analysed and says so", () => {
    expect(analyseCost(rows(1, 2))).toBe(2);
    expect(analyseLabel(rows(1, 2))).toBe("Analyse (2 credits)");
    expect(analyseLabel(rows(0, 1))).toBe("Analyse (1 credit)");
    expect(analyseLabel(rows(3, 0))).toBe("Refresh summary (free)");
  });

  it("counts the slots left and reads only well-formed analyses", () => {
    expect(slotsLeft(rows(4, 4))).toBe(2);
    expect(slotsLeft(rows(10, 1))).toBe(0);
    expect(insightOf(done)).toEqual(done);
    expect(insightOf({ headline: "H" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @chitrapx/web exec vitest run test/referenceModel.test.ts`
Expected: FAIL. The module does not exist.

- [ ] **Step 3: Model and board**

`apps/web/src/components/referenceModel.ts`:

```ts
import { competitorInsightSchema, MAX_REFERENCES_PER_APP, type CompetitorInsight } from "@chitrapx/document";

export type ReferenceRow = { id: string; url: string; insight: unknown };

/** An image's analysis, or null while it is not analysed (or the stored shape is outdated, which re-analyses). */
export function insightOf(raw: unknown): CompetitorInsight | null {
  const p = competitorInsightSchema.safeParse(raw);
  return p.success ? p.data : null;
}
export const analyseCost = (rows: ReferenceRow[]) => Math.min(MAX_REFERENCES_PER_APP, rows.filter((r) => !insightOf(r.insight)).length);
export const slotsLeft = (rows: ReferenceRow[]) => Math.max(0, MAX_REFERENCES_PER_APP - rows.length);
export function analyseLabel(rows: ReferenceRow[]): string {
  const n = analyseCost(rows);
  return n ? `Analyse (${n} credit${n === 1 ? "" : "s"})` : "Refresh summary (free)";
}
```

`apps/web/src/components/ReferenceBoard.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { followJob } from "@/lib/followJob.ts";
import { uploadAsset } from "@/lib/uploadAsset.ts";
import { api } from "@/server/api.ts";
import { jobError } from "./jobText.ts";
import { analyseLabel, insightOf, slotsLeft, type ReferenceRow } from "./referenceModel.ts";

/** Competitor screenshots the team uploads: analysed once each, summarised into the AI brief. Never exported or placed in projects. */
export function ReferenceBoard({ appId, rows, summary: saved }: { appId: string; rows: ReferenceRow[]; summary: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [summary, setSummary] = useState(saved);
  const left = slotsLeft(rows);

  async function upload(files: FileList) {
    const list = Array.from(files).slice(0, left);
    const failed: string[] = [];
    for (const [i, file] of list.entries()) {
      setBusy(`Uploading ${i + 1} of ${list.length}`);
      try { await uploadAsset(appId, "reference", file, { analysisRights: true }); }
      catch (err) { failed.push(`${file.name}: ${(err as Error).message}`); }
    }
    if (files.length > list.length) failed.push(`Only ${left} more image${left === 1 ? "" : "s"} fit on the board.`);
    setErrors(failed);
    setBusy("");
    router.refresh();
  }

  async function analyse() {
    setBusy("Analysing");
    setErrors([]);
    try {
      const { jobId } = await api<{ jobId: string }>(`/api/apps/${appId}/reference`, "POST");
      const job = await followJob(jobId);
      if (job.status === "failed") throw new Error(jobError(job.error));
      setSummary((job.output as { summary?: string } | null)?.summary ?? summary);
      router.refresh();
    } catch (err) { setErrors([(err as Error).message]); }
    finally { setBusy(""); }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this image and its analysis?")) return;
    try { await api(`/api/apps/${appId}/reference/${id}`, "DELETE"); router.refresh(); }
    catch (err) { setErrors([(err as Error).message]); }
  }

  async function saveSummary() {
    try { await api(`/api/apps/${appId}`, "PATCH", { brief: { competitor: summary } }); setErrors([]); router.refresh(); }
    catch (err) { setErrors([(err as Error).message]); }
  }

  return (
    <section className="card space-y-3" aria-label="Competitor reference board">
      <div>
        <h2 className="font-semibold">Competitor reference board</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Upload screenshots from competing apps. Chitrapx reads each one once and adds a short competitive angle to your AI brief. These images are never exported or placed in projects.
        </p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={rights} onChange={(e) => setRights(e.target.checked)} />
        <span>I have the right to analyse these images, for example public store screenshots used for research.</span>
      </label>
      <button type="button" className="btn-ghost" disabled={!rights || left === 0 || !!busy} onClick={() => input.current?.click()}>
        {busy.startsWith("Uploading") ? busy : left ? `Upload screenshots (${left} left)` : "The board is full (10 images)"}
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
      {errors.length > 0 && <ul role="alert" className="error list-disc pl-5 text-sm">{errors.map((m) => <li key={m}>{m}</li>)}</ul>}
      {rows.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {rows.map((r) => {
            const insight = insightOf(r.insight);
            return (
              <li key={r.id} className="space-y-1 rounded-lg border border-neutral-200 p-1 text-xs dark:border-neutral-800">
                <img src={r.url} alt="Competitor screenshot" className="aspect-[9/19.5] w-full rounded object-cover" loading="lazy" />
                {insight ? (
                  <dl className="space-y-0.5">
                    <dt className="sr-only">Headline</dt><dd className="font-medium">“{insight.headline}”</dd>
                    <dt className="sr-only">Claims</dt><dd>Claims: {insight.benefit}</dd>
                    <dt className="sr-only">Layout</dt><dd>Layout: {insight.layout}</dd>
                    <dt className="sr-only">Mood</dt><dd>Mood: {insight.colourMood}</dd>
                    <dt className="sr-only">Stand apart</dt><dd>Stand apart: {insight.differentiate}</dd>
                  </dl>
                ) : <p className="text-neutral-500">Not analysed yet</p>}
                <button type="button" className="text-red-600 hover:underline" onClick={() => remove(r.id)}>Delete</button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="btn" disabled={!rows.length || !!busy} onClick={analyse}>{busy === "Analysing" ? "Analysing" : analyseLabel(rows)}</button>
      <div>
        <label className="label" htmlFor="ref-summary">Competitive angle (added to the AI brief as competitor notes)</label>
        <textarea id="ref-summary" className="input min-h-20" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Appears after the first analysis. Edit it freely." />
        <button type="button" className="btn-ghost mt-1" disabled={summary === saved} onClick={saveSummary}>Save notes</button>
      </div>
    </section>
  );
}
```

In `apps/web/src/app/dashboard/apps/[appId]/page.tsx`:
- Import `ReferenceBoard` and `listReferences` from `@/server/uploads.ts`.
- Load the references with the rest: `const [projects, assets, fonts, references] = await Promise.all([listProjects(ctx, app.id), listAssets(ctx, appStorage(), app.id), listFonts(ctx, appStorage()), listReferences(ctx, appStorage(), app.id)]);`.
- Right after `<AiDesignCard … />`, render:

```tsx
      <ReferenceBoard appId={app.id} rows={references.map(({ id, url, insight }) => ({ id, url, insight }))} summary={app.brief.competitor ?? ""} />
```

In `apps/web/src/components/AiDesignCard.tsx`, after the keywords grid, add:

```tsx
      {saved.competitor && <p className="text-xs text-neutral-500">Competitor notes from your reference board are included.</p>}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @chitrapx/web exec vitest run test/referenceModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Full verification**

Run: `pnpm test && pnpm typecheck && pnpm lint`, then the e2e suite with the dev-server commands in Global Constraints.
Expected:
- All pass. The only typecheck error is `billing.ts:61`.
- The new goldens are `rtl-ar.png`, `rtl-ar-mirrored.png`, `rtl-he.png` and `chips-de.png`. Every other golden is unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(dashboard): competitor reference board with a rights notice, per-image analysis and an editable competitive angle"
```

---

## Manual browser checks (after all tasks; magic-link login blocks automation)

Run the worker with `ANTHROPIC_API_KEY` set for the AI checks.

1. **Brief and presets:**
   - Pick "Finance / Fintech" on an empty brief: the brief, audience and tone fill in.
   - Type a brief and pick another preset: a confirm appears first.
   - Start a design, then reopen the app: every field is prefilled.
   - A 2100-character brief is refused with the message and charges nothing.
2. **Copy variants:** with a saved brief, "Suggest copy" writes variants that follow it. Check the job's output and tone.
3. **Translations table:**
   - Open the table with three languages: untranslated cells are amber, `ar-SA` has `RTL`, and every header shows its counts.
   - Edit a cell, reload: it is still there and marked hand-written.
   - Export CSV, change two cells in a spreadsheet and import: exactly two changes show in the preview, and an unknown id row is listed as skipped.
   - Export JSON and import it: no changes.
4. **AI translation:** translate `ar-SA` and `de-DE` from `fr-FR`. Hand-written cells are kept, the ledger shows 2 credits per language that came back, and a glossary term stays untranslated.
5. **RTL:**
   - An Arabic headline puts "؟" at its left end and keeps "Bloom" readable, in the editor and in an exported PNG.
   - A left-aligned caption is right-aligned in `ar-SA` and `he`.
   - With "Mirror layout in RTL languages" on, the device and the text swap in `ar-SA` only, the canvas there has no handles, and `en-US` is unchanged.
6. **Chips:**
   - A Play app's AI design has a feature graphic with 4–6 chips.
   - "Regenerate chips" replaces only the chips and charges 1.
   - Translating to `de-DE` gives German chips that stay inside the 1024×500 board.
   - Editing a chip, reloading and exporting shows the edit.
7. **Competitor board:**
   - Uploading is disabled until the rights box is ticked.
   - Three uploads and "Analyse (3 credits)" give per-image notes and a summary. A second "Refresh summary (free)" charges nothing.
   - The images are not in the editor's asset picker, the screenshot grid or any export ZIP.
   - Deleting one removes its notes.
   - An AI design started afterwards says "Competitor notes … are included".
