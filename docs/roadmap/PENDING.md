# Chitrapx: Pending Work

As of 2026-10-05.

## Status at a glance

Three sub-projects remain: SP12 is next, then SP15; SP16 can go in any time. SP10 and SP11 are built, reviewed and merged into `main`.

| # | Sub-project | Status | Where |
| --- | --- | --- | --- |
| SP8 | Sizes and export | Done | `main` |
| SP9 | Editor essentials | Done | `main` |
| SP10 | Typography and style (plus S3 storage) | Done, merged 2026-10-05 | `main` (`db97254`) |
| SP11 | Localization and AI copy | Done, merged 2026-10-05 (migrations 0010, 0011 applied to the dev database) | `main` (`ed2004a`) |
| SP12 | Launch assets | Built on a branch, awaiting review (no migration) | spec `docs/superpowers/specs/2026-10-06-sp12-launch-assets-design.md` |
| SP15 | Collaboration | 15.1, 15.2, 15.4 built; needs migration 0014 applied after merge; 15.3 separate | spec `docs/superpowers/specs/2026-10-06-sp15-roles-share-comments-design.md` |
| SP16 | Polish | Built; needs migration 0013 applied after merge | SP16 branch |
| SP13 | Developer automation (API, CLI, MCP) | Dropped | — |
| SP14 | Store publishing and sync | Dropped | — |

Build order: SP10 → SP11 → SP12 → SP15.

## Pending sub-projects

Each group has a roadmap file under `docs/roadmap/` with acceptance criteria; none of the remaining three has a spec or plan yet.

| # | Goal | Features |
| --- | --- | --- |
| SP12 Launch assets | Turn one 1024×1024 image into every store icon file, and screenshots into a collage or framed-device PNG | 12.1 App icon generator · 12.2 Logo starter · 12.3 Collage · 12.4 Device mockup export |
| SP15 Collaboration | Share by link, invite teammates with roles and seat limits, co-edit live, comment on boards | 15.1 Share a copy by link · 15.2 Team invites and roles (owner, admin, editor, viewer) · 15.3 Live co-editing (presence, cursors, sync) · 15.4 Comments on boards |
| SP16 Polish | Release notices, changelog, opt-in analytics, shared templates, and leftovers | 16.1 "New version available" banner · 16.2 Changelog page · 16.3 Privacy-friendly analytics with cookie consent · 16.4 Community template feed · 16.5 Small leftovers (export dialog Escape and focus trap, unused web deps, named-version cap, e2e log cleanup) · deferred SP9 review items |

## Pending tasks

Sign-in needs one dashboard setting before it works; the rest are checks and small upkeep.

**Live Supabase**

- [ ] Authentication → URL Configuration: Site URL `http://localhost:3000`, Redirect URL `http://localhost:3000/auth/callback` (plus the production equivalents later)
- [ ] Sign in once through the browser (email magic link or GitHub) and confirm a workspace is created
- [ ] Raise vitest timeouts so `pnpm test` passes against the remote dev database (15 web tests time out at 20 s; worker suite not yet run there)

**SP10 manual browser checks** (from the end of the SP10 plan)

- [ ] Storage: upload a screenshot and a recording, import a `.chitrapx` file, download an export ZIP; MinIO shows only `staging/` keys before completion
- [ ] Fonts: no Google request on editor load; picker previews load on scroll; an uploaded `.woff2` renders on the canvas and in an exported PNG; deleting an in-use font is refused with the projects listed
- [ ] Rich text: bold plus a gradient on two words is one undo each; typing before them keeps the styling; a translation shows the "reapply" note
- [ ] Brand: extraction gives the same swatches each time; a brand swatch recolours text when the palette changes; Text on Surface below 4.5:1 warns
- [ ] Formulas: "Select a headline first" with nothing selected; a leftover `[verb]` appears in Checks
- [ ] CarPlay: in the Vehicle group; switching a phone makes a centred landscape frame; export lands in the iPhone 6.9" folder
- [ ] Styles: all 18 previews show; applying one is one undo step; applying it twice adds nothing

**Upkeep**

- [x] Mark SP10 done in `docs/roadmap/README.md`
- [x] Delete the merged `sp10-typography-style` branch

## Deferred SP10 review findings

All ten minor issues from the final SP10 review are now fixed on `main` (2026-10-05).

| # | Issue | Fix | File |
| --- | --- | --- | --- |
| ~~M1~~ (fixed) | Two simultaneous uploads of the same font face can both get in | Check for the existing face under the workspace lock, or add a unique index | `apps/web/src/server/uploads.ts` |
| ~~M2~~ (fixed) | A font can be linked into an app as an asset; deleting the font then removes bytes that row still uses | Filter the sibling lookup by kind; skip the object delete if another row shares the hash | `uploads.ts`, `apps/web/src/server/fonts.ts` |
| ~~M3~~ (fixed) | Editing an emoji inside styled text can split it and show a broken character | Keep mark offsets off UTF-16 surrogate boundaries | `packages/document/src/richText.ts` |
| ~~M4~~ (fixed) | Two deletes at once can remove both faces of an in-use family | Count and delete inside one locked transaction | `apps/web/src/server/fonts.ts` |
| ~~M5~~ (fixed) | Version-history preview shows no brand colours or uploaded fonts | Pass `extras` to the preview | `apps/web/src/editor/ui/VersionsDialog.tsx` |
| ~~M6~~ (fixed) | No cap on concurrent font-parse threads (up to 256 MB each) | Small semaphore around `parseFont` | `packages/db/src/fontParse.ts` |
| ~~M7~~ (fixed) | Export allow-list origin may not match the signed S3 origin (dotted bucket names, regional endpoints) | Derive the origin from a real presigned URL | `packages/storage/src/config.ts` |
| ~~M8~~ (fixed) | A font name wrapped in quotes never matches its own @font-face | Strip leading and trailing quotes when cleaning names | `packages/document/src/fontCatalog.ts` |
| ~~M9~~ (fixed) | Project import can leave unused font files in storage | Upload font bytes only for faces actually inserted | `apps/worker/src/bundle.ts` |
| ~~M10~~ (fixed) | Contrast check ignores brand-token colours | Resolve the palette before linting | `packages/document/src/aso.ts` |

## Open decisions

Two choices are waiting on you.

| Decision | Options | Recommendation |
| --- | --- | --- |
| Old local Supabase volumes (`supabase_db_Chitrapx` and two others) | Delete them (cannot be undone) or keep them | Delete; the app now runs on the live dev project |
| Google sign-in | Enable the Google provider in Supabase or hide the button | Enable it if Google login is wanted; the login page already shows the button |

## SP11 follow-ups

Built and merged; these were left for later.

- [ ] Manual browser checks from the end of the SP11 plan (brief and presets, translations table, AI translation, RTL, chips, competitor board). The AI checks need `ANTHROPIC_API_KEY` in `.env` and the worker running.
- [ ] Twelve minor review findings, listed as `Final: minor (deferred)` in the SP11 ledger (`.superpowers/sdd/2026-10-05-sp11-localization-ai-copy/progress.md`). The most user-visible: arrow keys still nudge elements in a mirrored view; paid competitor analyses count toward the free hourly limit; a Play AI design fails if fewer than 4 chips come back.
- [ ] Remote-database test flakiness: two `bundle.test.ts` "under 1000 ms" checks and the billing "daily grant" test (scans every workspace) time out against the shared dev database.


## SP16 follow-ups

- [ ] Apply migration `0013_sp16_community_analytics` (community tables, `analytics_events`, RLS) after merging; renumber its journal entry if another branch also took that slot.
- [ ] Set `STAFF_EMAILS` for community moderators, `NEXT_PUBLIC_ANALYTICS=on` to start counting, and `BUILD_ID` (the commit hash) on the deploy platform.
- [ ] Run `apps/worker/test-e2e/polish.test.ts` with the web app up.
- [ ] Watch the report-only CSP in the browser console, then switch `proxy.ts` to the enforcing header.
- [ ] Deferred SP9 items: the ⌘G no-op notice (`editor/shortcuts.ts`), status-bar goldens for other platforms, a real-browser keyboard-drag test in the layers panel.

## SP15 follow-ups (roles, share links, comments)

- [ ] Apply migration `0014_sp15_collaboration` (merged; member_role becomes owner/admin/editor/viewer; existing `member` rows become `editor`; new tables `workspace_invites`, `project_shares`, `project_comments`, `notifications` with read-only RLS).
- [x] 15.3's command route uses `requireContext("edit")` and `canSendCommands` uses `can(ctx, "edit")` (wired at merge).
- [ ] Replace the comments poll with the Realtime channel.
- [ ] Run `apps/worker/test-e2e/collaboration.test.ts` with the web app up.
- [ ] Deferred: comment pins drawn on the canvas (anchors are stored), a comment count on project cards, seat add-ons, email delivery of invites and mentions.

## SP15.3 live co-editing follow-ups

Merged into `main` (spec `docs/superpowers/specs/2026-10-06-sp15-live-coediting-design.md`, plan with the manual check list `docs/superpowers/plans/2026-10-06-sp15-live-coediting.md`).

- [x] Migration `0015_sp15_live_coediting` rechained after 0014 at merge (snapshot `prevId` = 0014).
- [ ] Apply migrations 0013, 0014 and 0015 to the dev database (`pnpm db:migrate`).
- [ ] Supabase: Realtime private channels must be allowed (Project Settings, Realtime). Migration 0015 adds the `realtime.messages` policies; without them the editor simply stays in solo mode.
- [ ] Run the twelve manual two-browser checks at the end of the SP15.3 plan, and `apps/worker/test-e2e/collab.test.ts` with the web app up.
- [ ] Measure Realtime latency and message limits on the chosen plan (roadmap open question 9); drags send one command at the end plus a preview every 80 ms.
- [ ] Later: compaction of `project_commands` (one row per coalesced command; a version every 100), a cap of about 10 editors, comments on the same channel (15.4).
