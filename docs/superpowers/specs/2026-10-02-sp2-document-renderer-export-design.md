# Sub-project 2: Document, Renderer, Templates, Server Export

**Date:** 2026-10-02
**Status:** Derived from the approved architecture (main spec, sections A5 and A6); built on the user's instruction "build next".
**Parent spec:** `2026-10-02-chitrapx-design.md`

## Goal

A customer opens an app, picks one of the imported templates, gets a project whose device screens are filled with their uploaded screenshots in order, sees every board rendered, and downloads a ZIP of store-size PNGs for every board and locale. The editor (sub-project 3) builds on exactly this document and renderer.

## Decisions beyond the parent spec

1. **Template images are not imported.** OSG's MIT licence covers its code and template JSON. Its artwork is not MIT: the photos are Adobe Stock licensed to OSG's owner (not sublicensable), and the rest has no written licence record (see OSG's `THIRD-PARTY-ASSETS.md`). The importer keeps every layout, text, shape, gradient and device, and removes every image reference:
   - device `screenshotSrc` becomes empty; the renderer draws a neutral placeholder screen, and "fill from my screenshots" replaces it;
   - `image` elements that point at OSG artwork are dropped;
   - board `backgroundImage` values that point at OSG artwork are dropped.
   The importer reports per template what it dropped. Template previews are rendered live by our renderer; no OSG preview PNG is shipped.
2. **Element coverage in this sub-project:** text, shape, image, device (flat CSS chrome and procedural three.js 3D, both ported from OSG), board backgrounds (solid, gradient, image, span). `video`, `video-device`, `gesture` and `audio` render as static frames (poster or nothing) until sub-project 6.
3. **Asset references** in documents are `asset:<uuid>`. The renderer never fetches on its own; it receives `resolveSrc(src) => string | null` and the page supplies signed URLs. Unresolvable sources render a placeholder in previews and fail the export.
4. **Localization** uses OSG's model unchanged (`ProjectLocalization` with `baseLocale` + `locales`, per-element locale overrides) and OSG's `projectArtboards(boards, locale)` projection. `baseLocale` defaults to `en-US`.
5. **Render page authentication:** the worker opens `/render/[jobId]?sig=…` where `sig` is an HMAC-SHA256 of `jobId.expiry` with `RENDER_SECRET`, valid 15 minutes and only while the job is `running`. The page loads the job's project doc server-side and signs its asset URLs.
6. **Export pricing:** `export: 1` credit per export run in `pricing.ts`.
7. **ZIP layout:** `<platform>/<target>/<locale>/<NN>-<board-name>.png`, built with `fflate`, stored in a private `exports` bucket at `<workspace_id>/<job_id>.zip`; downloaded through a signed URL from `/api/jobs/[jobId]/download`.
8. **Readiness:** the render page sets `window.__chitrapxReady = { ok, errors }` after `document.fonts.ready`, every `<img>` has decoded, and every 3D device has drawn its first frame. Any error fails the job by name.
9. **WebGL budget:** browsers keep about 16 WebGL contexts. Gallery and project pages mount 3D devices only while visible; the export page renders boards in batches of at most 8 3D devices.

## Units

| Unit | Responsibility |
|---|---|
| `packages/document` | ChitrapxDoc and OSG artboard types, Zod schema, `migrate`, `targets.ts` registry, `retarget`, `fillScreenshots`, template importer |
| `packages/renderer` | `<BoardView>`, OSG element renderers (static), backgrounds, fonts, i18n projection, readiness tracking |
| `packages/assets` | converted template JSON (`templates/*.json`) + `NOTICES` entries; no third-party images |
| `packages/db` | `templates` seed, `export` price, `exports` bucket config |
| `apps/web` | template gallery, create project from template, project page with board previews, export button and history, `/render/[jobId]` page, download route |
| `apps/worker` | `export` handler: Playwright Chromium, screenshot each board per locale, zip, upload, settle |

## Acceptance criteria

- The importer converts all 101 OSG templates; each passes the Zod schema; none references a file under OSG's `public/`.
- Creating a project from a template with 3 uploaded screenshots fills the first 3 device screens in board order.
- The project page shows every board; the gallery shows the first board of each template.
- Exporting a 5-board project with 2 locales produces a ZIP of 10 PNGs, each exactly the target pixel size, and charges 1 credit; a failed export refunds it.
- An export whose document references a missing asset fails with `asset_missing` and refunds.
- A 3D device renders in the exported PNG (non-placeholder pixels inside its bounds).
- Golden test: three reference templates rendered by the export path match committed PNGs within 0.5% differing pixels.
- Retargeting a 1290x2796 board to 1242x2688 keeps every element inside the board and preserves relative positions within 1 px.
