# Sub-project 4 Implementation Plan: AI Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One-click AI design, translation and copy variants.
**Architecture:** Worker job handlers call a `StructuredModel` interface (Anthropic in production, scripted fake in tests); pure planners build prompts and pure appliers turn plans into documents.
**Tech Stack:** @anthropic-ai/sdk 0.131 (beta parse, betaZodOutputFormat, fallbacks), sharp, Zod 4.
**Spec:** `docs/superpowers/specs/2026-10-02-sp4-ai-pipeline-design.md`

## Global Constraints
- The model never returns document JSON; only plans validated by Zod.
- Model ids only `claude-sonnet-5-5` and `claude-haiku-4-5`.
- Prices only in `packages/db/src/pricing.ts`.
- No em or en dashes in user-facing copy (prompts ask the model for none too).

## Review Focus
1. **Model picks a template that does not exist or a screenshot index out of range:** fail and refund, never crash or write a broken doc. Task 3.
2. **Model returns text for element ids that are not text slots or absurdly long text:** ignored or capped. Task 3.
3. **Translate over manual edits:** manual overrides survive. Task 4.
4. **Project edited while the job runs:** revision increments; editor gets 409, nothing lost. Task 5.
5. **App with zero screenshots:** design fails early with a clear error, refunded. Task 5.

---

### Task 1: Data and pricing
- [x] `screen_insights` table + migration; prices; `reserveAndEnqueue` accepts a computed cost (`priceFor`).

### Task 2: Catalog
- [x] `packages/document/scripts/gen-catalog.ts` writes `packages/assets/catalog.json`; test fails when stale.

### Task 3: Planning and applying (pure)
- [x] Schemas (ScreenInsight, TemplateChoice, SlotCopy, Translations, Variants); `textSlots(doc)`; `applyDesign`, `applyTranslations`, variants mapping; tests.

### Task 4: Model client
- [x] `StructuredModel` interface; Anthropic implementation (parse, caching, fallbacks, refusal and error mapping, usage); image preparation with sharp; fake for tests.

### Task 5: Job handlers
- [x] `ai_design`, `ai_translate`, `ai_copy` handlers with project locking; tests with the fake model against the real database.

### Task 6: Web
- [x] Routes: `POST /api/apps/[appId]/ai-design`, `POST /api/projects/[id]/translate`, `POST /api/projects/[id]/copy-variants`; UI: AI design card on the app page, job status on the project page, translate and variants panels in the editor.
