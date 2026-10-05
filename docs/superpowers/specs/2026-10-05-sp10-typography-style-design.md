# Sub-project 10: Typography and style (plus S3 storage)

Users bring their own fonts, style single words inside one headline, pull a brand palette from their screenshots, apply one of 18 named styles in one click, start from headline formulas, frame CarPlay shots, and pick from a large on-demand Google Fonts catalogue. Before any of that, all object storage moves from Supabase storage to S3. Feature breakdown and reference code: `docs/roadmap/sp10-typography-style.md`.

## Decisions

- **Storage**: all object storage (uploads, exports, bundles) moves to S3-compatible storage (AWS S3, Cloudflare R2, MinIO) through one shared `packages/storage`. Supabase stays for Postgres and auth only. Supabase storage code is deleted, not kept behind a switch. No data migration: existing storage holds dev data only.
- **Fonts are owned by the workspace** (`assets.appId = null`), usable in every app. One upload = one face; faces with the same family group into one picker entry.
- **Font licensing**: an "I have the right to embed this font" checkbox is required, and fonts whose OS/2 `fsType` forbids embedding (restricted licence, bit 1) are rejected.
- **Font quota**: 20 faces or 50 MB per workspace, whichever comes first.
- **Font parsing** uses `fontkit` (MIT; reads ttf, otf, woff, woff2) inside a `worker_thread` with a 5 s timeout and a 256 MB heap cap.
- **Rich text = marks over plain text**: `content` stays a plain string; `marks` are ranges with style. Pure logic ported from PixelDeck (MIT).
- **All 18 named styles ship, simplified**: built only from what the renderer draws today (backgrounds, gradients, fonts, colours, text treatment, device treatment). Styles that need new art get the closest approximation; there are no new decorative element types.
- **Google Fonts catalogue** is a committed JSON snapshot (150–300 families) produced by a script; no API key at build or runtime.
- **Brand tokens** (`brand:<token>`) resolve once, in board preparation (`boardFor`), so canvas, preview, export and video agree.
- **Named styles write literal values** into elements; `group.styleId` is for display only, so exports never depend on later changes to style definitions.
- **No document schema version bump and no DB migration**: every new document field is optional; font metadata uses the existing `assets.meta` jsonb; the assets unique key (`workspaceId, appId, sha256`, nulls not distinct) already dedupes workspace fonts.
- Every editor change is one `apply(command)` = one undo step; a command that changes nothing returns the same document.

## 1. Storage on S3

New package `packages/storage` (used by `apps/web` and `apps/worker`):

- `ObjectStorage` interface, moved from `apps/web/src/server/storage.ts` and extended for the worker:
  - `presignPut(path, { contentType, contentLength })` → `{ url, headers }`; URL valid 10 minutes; signs `Content-Length`, `Content-Type` and `If-None-Match: *` so the object is created once at exactly the size the server checked and never overwrites.
  - `download(path)`, `downloadStream(path)`, `put(path, bytes, contentType)`, `remove(path)`, `exists(path)`.
  - `move(from, to)`: fails if `to` exists (checked with `HeadObject`), then `CopyObject` + `DeleteObject`.
  - `signedUrls(paths)` (1 hour) and `signedDownload(path, filename)` (5 minutes, `Content-Disposition: attachment`).
  - Bucket chosen per call: `uploads` or `exports`.
- `s3Storage()` built on `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`; config from env: `S3_ENDPOINT` (optional), `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_UPLOADS`, `S3_BUCKET_EXPORTS`, `S3_FORCE_PATH_STYLE` (`true` for MinIO). Missing required env fails at startup with a message naming the variable.
- `memoryStorage()` for unit tests (the existing in-memory fake, moved).
- `storageOrigin()` returns the origin signed URLs point at (endpoint origin, or the AWS virtual-host origin).

Callers:

- `apps/web/src/server/storage.ts` re-exports from `packages/storage`; `uploads.ts` returns `{ uploadId, url, headers }` from `/api/uploads/sign` instead of a Supabase token.
- `apps/web/src/lib/uploadAsset.ts` and `ImportProjectButton.tsx`: `fetch(url, { method: "PUT", headers, body: file })`. A failed PUT shows "Upload failed — try again".
- `/api/uploads/complete` is unchanged in behaviour: download staged object, re-sniff, check checksum, `move` into place.
- Worker (`export.ts`, `video.ts`, `handlers.ts`, `bundle.ts`) uses `packages/storage`; the export browser allow-list (`exportOrigins`) replaces the Supabase origin with `storageOrigin()`.
- All Supabase storage calls are removed; `@supabase/supabase-js` stays for auth and DB where it is used today.

Setup and dev:

- `scripts/s3-setup.ts`: creates both buckets if missing; sets CORS (allowed origin `WEB_ORIGIN`, methods `PUT, GET, HEAD`, headers `content-type, content-length, if-none-match`); lifecycle rules: delete `staging/` objects after 1 day in `uploads`, and delete objects in `exports` after the retention period the export code already uses.
- `docker-compose.yml` with a MinIO service (ports 9000/9001) for local dev and e2e; `.env.example` gains the S3 variables; README dev steps updated.

## 2. Document model

`packages/document`:

- Shared gradient type: `Gradient = { kind: "linear" | "radial"; angle?: number; stops: { color: string; at: number }[] }` (2–8 stops, `at` in 0–1, sorted on normalise).
- Text element gains:
  - `marks?: TextMark[]`, `TextMark = { start: number; end: number; color?: string; gradient?: Gradient; fontWeight?: number; italic?: boolean }`, start inclusive, end exclusive, offsets in UTF-16 code units of `content`.
  - `gradient?: Gradient` (whole-box fill).
- Per-locale text override may carry `marks` beside `content` and `fontFamily`.
- Group gains `styleId?: string`.
- Validation (`doc.ts`): mark and gradient colours go through `cssSafe` (`url(`, `expression(`, etc. rejected); marks are normalised (clamped to content length, empty dropped, overlaps split, equal neighbours merged), never rejected for range problems. `fontFamily` is validated: max 100 chars, none of `"\;{}<>` or control characters.
- Any colour field (including gradient stops and mark colours) may be `brand:<token>` with token in `primary | secondary | accent | surface | text | muted`.
- `resolveBrand(elements, palette)` (new `packages/document/src/brand.ts`, logic ported from PixelDeck `brandColors.ts`, MIT) replaces tokens with hex; unknown token or missing palette → the field is dropped so the element default applies. Called in `packages/renderer/src/board.ts` `boardFor`, next to the hidden filter; the palette reaches the renderer with the doc's render input.
- Documents saved before SP10 pass `migrate` unchanged (test).

DB (`packages/db`):

- `Brand` gains `palette?: { token: BrandToken; color: string }[]` (max 6, hex only, unique tokens). `primaryColor`/`secondaryColor` remain and seed the `primary`/`secondary` slots when `palette` is absent.
- `AssetMeta` gains the font shape: `{ family: string; weight: number; italic: boolean; format: "ttf" | "otf" | "woff" | "woff2" }`.

## 3. Fonts

### 3.1 Catalogue and picker

- `scripts/gen-font-catalog.ts` writes `packages/renderer/src/osg/lib/fontCatalog.json`: 150–300 curated families with `family, category, weights, italics, scripts`; includes every family the 18 styles reference and every family currently in `GOOGLE_FONTS`. Committed.
- `fontService.ts` reads the catalogue (keeps `SYSTEM_FONTS`, script groups used by `fontLanguageMatcher.ts`). The editor makes no Google Fonts request on load; `ensureFont(family, weight?, italic?)` loads on demand via `document.fonts.load`.
- `fonts.tsx` `googleFontsHref` requests `ital,wght@` tuples for families used with italic, else `wght@`; still only families used on the boards; `display=block`.
- New `apps/web/src/editor/ui/FontPicker.tsx`: search, category filter, groups "Used in this project", "Your fonts", "Google Fonts"; previews load when a row scrolls into view (IntersectionObserver). Replaces the font `SelectField` in `Inspector.tsx` and the heading/body font fields in `BrandForm.tsx`.

### 3.2 Upload

- `packages/db/src/assetCheck.ts`: `font` added to `AssetKind`, `ACCEPTED.font` (`font/ttf`, `font/otf`, `font/woff`, `font/woff2`), `HEAD_BYTES.font`; sniff by magic bytes (`00 01 00 00`, `true`, `OTTO`, `wOFF`, `wOF2`); client MIME and extension ignored. 10 MB limit (`UPLOAD_LIMITS.font`) at sign time and while streaming; empty files rejected.
- `parseFont(bytes)` in `packages/db/src/fontParse.ts` runs fontkit in a `worker_thread` (5 s timeout, 256 MB heap). Returns `{ family, weight, italic, format, embeddable }` from the `name` (family, subfamily only) and `OS/2` tables. `fsType` bit 1 set (restricted) → reject `font_restricted`. Parse failure or timeout → reject `font_unreadable`. Nothing is stored on rejection.
- Family collisions with a built-in or catalogue family get the suffix ` (custom)`. A second face of an existing uploaded family joins that family.
- Upload sign accepts `kind: "font"` with no `appId` and requires `embedRights: true`; quota (20 faces / 50 MB per workspace) checked at sign time → `font_quota` with counts in the message.
- `GET /api/fonts`: the workspace's font families with faces `{ assetId, weight, italic, format }`.
- `DELETE /api/fonts/:assetId`: blocked with 409 and the list of projects whose doc uses the family (only if it is the family's last face); otherwise deletes row and object.
- UI: "Your fonts" section in the FontPicker with an Upload button; dialog with file input and the rights checkbox; errors shown inline with the reasons above.

### 3.3 Rendering, export and bundles

- `fonts.tsx` gains `customFontFaceCss(faces)`: one `@font-face` per face used, `font-family` quoted and escaped, `src: url(<signed url>) format(...)`, `font-weight`, `font-style`, `font-display: block`. `BoardFonts` renders it in a `<style>` beside the Google `<link>`. The editor and the export render page get the face list (family, weight, italic, signed URL) with the doc.
- Export waits on `document.fonts.ready` as today (`packages/renderer/src/ready.ts`).
- Fonts are stored with `Content-Type: font/*` set at upload; signed GETs add `X-Content-Type-Options: nosniff` via response header overrides where the provider supports it.
- A missing custom family (deleted, failed to load) falls back to the next family in the CSS stack; readiness warns "Font <family> is missing" before export.
- Bundles (`packages/document/src/bundle.ts`): manifest `assets[].kind` adds `font` with `family`, `weight`, `italic`; `extFor` adds font types; export includes the faces of every custom family the doc uses; import restores them into the target workspace (dedupe by sha256; family collision rules as on upload).

## 4. Rich text

- `packages/document/src/richText.ts` (port of PixelDeck `richText.ts`, MIT, attributed in `NOTICES.md`): `normalizeMarks`, `applyMark(marks, range, style)`, `clearMark(marks, range, keys?)`, `rangeStyle(marks, range)` (common style or `"mixed"` per key), `segments(content, marks)`, `remapMarks(oldContent, newContent, marks)`.
- `remapMarks` finds the edited region by common prefix and suffix: marks before it keep offsets, marks after shift by the length change, marks overlapping it are clipped, marks fully inside a deletion are dropped.
- Renderer (`TextElement.tsx`): no marks → unchanged output. With marks → spans from `segments()`; gradient segments use `background-image` + `background-clip: text` + transparent fill; whole-box `gradient` the same on the text node. Wrapping is the browser's. Auto-fit (`textFit.ts`) measures the rendered node as today.
- Weight marks use the same family; the board stylesheet requests the weights used; when the family lacks a weight the nearest available weight is requested (no synthetic bold).
- Editing: the contenteditable shows spans. A floating `RichTextToolbar.tsx` appears for a non-empty selection while editing: colour (with brand swatches), gradient, weight, italic, clear. Applying sends one command `setTextRich { ref, content, marks }` (current DOM text + new marks) = one undo step; editing continues. On commit (blur) the text update applies `remapMarks` in the same `updateElement`, so typing stays one undo step. With no selection, the inspector styles the whole box as today.
- Languages: a locale override may hold its own `marks`. If its `content` differs from the base and it has no own marks, it renders unstyled and the inspector shows "Styling not carried to this language — reapply".
- Retargeting (`retarget.ts`) leaves marks untouched (font size scales the whole element).

## 5. Brand palette

- `BrandForm.tsx` gains `PaletteGrid.tsx`: 6 slots (`primary, secondary, accent, surface, text, muted`), hex input + colour picker each, reset. Server (`apps/web/src/server/apps.ts`) validates hex, max 6, known unique tokens.
- "Extract from screenshots" (`apps/web/src/lib/colorExtract.ts`, own code; storeshots ideas only): each screenshot drawn at 64 px max side on a canvas; pixels bucketed by 32 levels per channel; near-white (all > 235), near-black (all < 20) and low-saturation (HSL s < 0.15) dropped; buckets ranked by count, neighbours within ΔE 10 merged; top 6 offered for review before save. Deterministic, no network. None found → "No distinct colours found in these screenshots".
- Contrast warning when `text` vs `surface` is below 4.5:1.
- Editor colour fields (`fields.tsx`) and the rich text toolbar show a Brand swatch row that writes `brand:<token>`. Changing a palette slot changes every field using the token at next render.

## 6. Named styles

- `packages/document/src/styles.ts`: 18 `StyleDef = { id, name, description, fonts: { heading, body }, palette: Record<BrandToken, string>, background: { color } | { gradient }, headline: { sizePct: [min, max], weight, tracking, lineHeight, case: "none" | "upper" | "lower", align }, body: { weight, lineHeight, case, align }, device: { rotation, shadow, frameStyle } }`. Numeric values lifted from `app-store-screenshots/.../style-prompts/` (MIT, attributed); descriptions written fresh.
- `applyStyle(doc, groupId, styleId)`: on every board of the group sets background, text fonts/colours/weights/tracking/line height/case/alignment and device rotation/shadow/frame style; never touches `content`, `marks`, screenshots or locale overrides; writes only differing values (idempotent); sets `group.styleId`. Undoable command `applyStyle`. An "Also save as my brand palette" checkbox additionally writes the style's palette to the app brand (separate API call).
- `StylePicker.tsx` in `LeftPanel.tsx`: grid of 18 previews. Previews are PNGs generated by `scripts/gen-style-previews.ts` rendering a fixed sample board through the renderer, committed under `apps/web/public/styles/`.
- Tests: every style's headline colour vs its background has contrast ≥ 4.5:1 (gradient: worst stop); every font exists in the catalogue; applying twice equals applying once; applying B after A equals applying B alone (on style fields).

## 7. Headline formulas

- `packages/document/src/copyFormulas.ts`: formulas by role (`hero, differentiator, feature, proof, closer`), each with a worked example; example banks for about 12 categories. Data from `app-store-screenshots/.../copy-ideas.md` (MIT, attributed). Keyed by id for later localisation.
- `HeadlineIdeas.tsx` beside `CopyIdeas.tsx` in the text inspector: role picker (default: first board = hero, last = closer, else feature), category picker, list with character count. Click inserts into the selected text element (one `updateElement`). No text element selected → "Select a headline first".
- `readiness.ts`: text containing `[word]` placeholders → warning "Unfilled placeholder in <board>".

## 8. CarPlay frame

- `deviceRegistry.ts`: `carplay` descriptor, new category `vehicle`, platform `ios`, `nativeAspect: 800 / 480`, bezel ~1.6%, outer radius ~2.2%/3.6%, screen radius ~1.4%/2.3%, no counterpart.
- `deviceChrome.tsx`/`DeviceFrameElement.tsx`: head-unit chrome ported from app-store-screenshots `CarPlayScreen` (MIT). Device picker shows a "Vehicle" group.
- Export plan: a board containing a CarPlay device exports into the iPhone target; no new store target. Registry and export-plan tests cover it.

## 9. Errors

- Upload: `unsupported_type`, `too_large` (at sign), `font_restricted`, `font_unreadable`, `font_quota`, failed PUT ("Upload failed — try again"). All shown inline in the upload dialog.
- S3 failures in a job are retryable (pg-boss retry as today); orphan staging objects removed by the lifecycle rule.
- Bad marks are normalised; unsafe values rejected by `cssSafe` with the field path.
- Unknown brand token or no palette → element default, readiness warning "Brand colour <token> not set".
- Missing custom font → fallback face, readiness warning.
- Style/formula with nothing to apply to → notice, document unchanged.

## 10. Testing

- Unit: `richText` (PixelDeck cases adapted + remap cases: insert before/inside/after, delete across, paste replace), `resolveBrand` (incl. gradient stops and marks), `colorExtract` (fixture pixel data → same swatches each run; greyscale → none), `styles` (contrast, fonts in catalogue, idempotence), `copyFormulas` insertion and placeholder check, CarPlay registry + export plan, catalogue round trip through `googleFontsHref` (incl. italic), font sniffing (each format, renamed .exe/.svg, empty, oversize, restricted fixture), `fontFamily` validation, storage contract against `memoryStorage`.
- Integration (local Supabase + MinIO): sign → PUT → complete; second PUT to the same URL refused; size mismatch refused; font list; font delete blocked when in use; quota; bundle round trip with a font into another workspace.
- Worker e2e + goldens (MinIO): custom woff2 headline, gradient + bold words in one headline, CarPlay frame; existing goldens unchanged.

## 11. Build order

1. S3 storage package, callers, MinIO, setup script.
2. Font catalogue + FontPicker + lazy loading + italic axis.
3. Font upload (sniff, parse, quota, API, UI).
4. Custom fonts in render, export and bundles.
5. Rich text logic (`richText.ts`) + schema.
6. Rich text rendering + toolbar + language behaviour.
7. Brand token resolution + palette grid + extraction.
8. Headline formulas.
9. CarPlay frame.
10. Named styles + previews.

## Out of scope

- New decorative element types (grid lines, mascots, SVG illustrations).
- Variable-font axis controls beyond weight and italic.
- Copying existing Supabase storage objects to S3.
- Per-app fonts; font sharing across workspaces.
