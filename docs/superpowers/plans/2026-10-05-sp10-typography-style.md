# Sub-project 10: Typography and Style (plus S3 storage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all object storage to S3. Then add a large Google Fonts catalogue loaded on demand, uploaded workspace fonts, rich text marks (colour, gradient, weight, italic), brand palette tokens with screenshot extraction, headline formulas, a CarPlay frame and 18 one-click named styles.

**Architecture:** A new `packages/storage` gives web and worker one `ObjectStorage` (S3/R2/MinIO, plus an in-memory fake for tests). Document additions are all optional fields. Pure logic lives in `packages/document`: `fontCatalog.ts`, `gradient.ts`, `richText.ts`, `brand.ts`, `copyFormulas.ts`, `styles.ts` and `docFonts.ts`. Brand tokens resolve once in `boardFor`. Uploaded fonts reach every render surface through one `RenderExtras` value (`{ faces, palette }`), which the server builds in `apps/web/src/server/renderExtras.ts`. Font parsing runs fontkit inside a `worker_thread` in `packages/db/src/fontParse.ts`, so both the web upload path and the worker bundle import use it. Every editor change is still one `apply(command)`.

**Tech Stack:** TypeScript, Next.js 16 (apps/web, non-standard: read `apps/web/node_modules/next/dist/docs/` before touching Next APIs), React 19, Zustand + Immer, Drizzle + Postgres (local Supabase), pg-boss, Playwright worker with golden PNGs, Vitest, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `fontkit`, MinIO in Docker.

**Spec:** `docs/superpowers/specs/2026-10-05-sp10-typography-style-design.md` (feature research and reference code: `docs/roadmap/sp10-typography-style.md`)

## Global Constraints

- No document `schemaVersion` bump and no DB migration. Every new document field is optional. Documents saved before SP10 must pass `migrate` unchanged.
- Every editor change is exactly one `apply(command)`, so it is one undo step. A command that changes nothing returns the same document.
- Elements stay `.passthrough()`. Every colour key, including mark colours and gradient stops (key `color`), is checked by `cssSafe` in `packages/document/src/doc.ts`.
- All object storage (uploads, exports, bundles) goes through `packages/storage`. Supabase storage code is deleted, not kept behind a switch. `@supabase/supabase-js` stays only where it is used for auth and DB today (apps/web).
- Storage env: `S3_ENDPOINT` (optional), `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_UPLOADS`, `S3_BUCKET_EXPORTS`, `S3_FORCE_PATH_STYLE` (`true` for MinIO). A missing required variable fails at startup with a message naming it.
- Link lifetimes: presigned PUT 10 minutes (signs `Content-Length`, `Content-Type`, `If-None-Match: *`); `signedUrls` 1 hour; `signedDownload` 5 minutes with `Content-Disposition: attachment`.
- Fonts belong to the workspace (`assets.appId = null`). One upload is one face. Quota: 20 faces or 50 MB per workspace, whichever comes first. Each font is at most 10 MB (`UPLOAD_LIMITS.font`). Formats: ttf, otf, woff, woff2, sniffed by magic bytes. The client MIME type and file extension are ignored.
- An upload needs `embedRights: true`. A font whose OS/2 `fsType` has bit 1 set is rejected `font_restricted`. A font that fails to parse, or takes more than 5 s, is rejected `font_unreadable`. fontkit runs in a `worker_thread` with a 256 MB heap cap. Nothing is stored on rejection.
- A family that clashes with a catalogue, system or generic family gets the suffix ` (custom)`.
- Upload error codes: `unsupported_type`, `too_large`, `font_restricted`, `font_unreadable`, `font_quota`, `embed_rights_required`, `font_face_exists`. A failed PUT shows "Upload failed — try again".
- Font catalogue: 150–300 Google families, committed as JSON. No API key at build or runtime. The editor makes no `fonts.googleapis.com` request until a font is used or previewed. Board stylesheets use `display=block`.
- Brand tokens: `brand:<token>` with token in `primary | secondary | accent | surface | text | muted`. An unknown token or a missing palette drops the field, so the element default applies.
- Named styles write literal values. `group.styleId` is for display only.
- New dependencies: only `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` and `fontkit`.
  - fontkit is listed in `packages/db`, where it is used, and in `apps/web`, so Next's server bundle can resolve it.
  - It is loaded only inside a worker thread, by file path, so no type package is needed.
- Ported MIT code gets a `NOTICES.md` row: PixelDeck (rich text mark algebra, brand token resolution) and app-store-screenshots (style values, headline formulas, CarPlay frame). storeshots is AGPL: take ideas only and copy nothing.
- Known pre-existing typecheck error: `apps/web/src/server/billing.ts:61` (TS2339, also on main). The gate is "no new errors".
- E2E runs need local Supabase, MinIO (`docker compose up -d minio && pnpm storage:setup`) and the web dev server at `WEB_ORIGIN`. Start the server in the background, record its PID, and stop it with `kill <pid>`. Never use `pkill`.
- **Dev-server commands.** Every browser check and e2e run in this plan uses exactly these commands, from the repo root:

  ```bash
  pnpm storage:up && pnpm storage:setup
  cd apps/web && (nohup ./node_modules/.bin/next dev > /tmp/chitrapx-web.log 2>&1 & echo $! > /tmp/chitrapx-web.pid); cd ../..
  for i in $(seq 1 60); do curl -sf http://localhost:3000/api/health > /dev/null && break; sleep 2; done
  # ... the browser check, or: pnpm --filter @chitrapx/worker test:e2e
  kill "$(cat /tmp/chitrapx-web.pid)"
  ```

## Review Focus

1. **Typing in a headline that already has styled words.** Inserting before, inside or after a styled word, or deleting across it, must keep the styling on the same letters. Deleting the whole styled word must remove its mark. `updateElement` and `setOverride` remap marks whenever content changes. Pinned in Task 11.
2. **A translated text with its own wording and no marks of its own** must render unstyled in that language. The base offsets must never paint the wrong letters. The editor must show the "reapply" note. Pinned in Task 10 (projection) and Task 11 (note condition).
3. **A font whose name table holds CSS-breaking text**, such as quotes, braces, `url(` or control characters, or an empty name. It must be stored under a cleaned family name that the document validator accepts and that cannot escape the `@font-face` rule. An empty result is `font_unreadable`. Pinned in Task 4 (`cleanFamilyName` cases), Task 6 (the parser applies it before the ` (custom)` rule) and Task 7 (`customFontFaceCss` escaping of a hostile family and URL).
4. **Deleting a font face.** Deleting the last face of a family that a project in *another app of the same workspace* uses must be blocked with that project listed. Deleting one face of a two-face family must succeed even while the family is in use. Pinned in Task 6.
5. **A document whose palette lacks a token it uses**, such as a project imported into an app with no palette. The renderer must get no `brand:` string. The field is dropped, readiness warns "Brand colour accent not set", and a gradient with an unresolved stop is dropped whole. Pinned in Task 12.

## File Structure

| File | Responsibility |
|---|---|
| `packages/storage/src/{types,config,memory,s3,setup,index}.ts` (create) | `ObjectStorage`, env config, in-memory fake, S3 client, bucket setup |
| `packages/storage/scripts/s3-setup.ts` (create) | creates buckets, CORS and lifecycle rules |
| `docker-compose.yml` (create) | MinIO for dev and e2e |
| `apps/web/src/server/storage.ts` (modify) | re-export plus `appStorage()` singleton |
| `apps/web/src/instrumentation.ts` (create) | fail at startup on missing storage env |
| `apps/web/src/server/uploads.ts`, `imports.ts` (modify) | presigned PUT, font uploads |
| `apps/web/src/lib/uploadAsset.ts`, `components/ImportProjectButton.tsx` (modify) | browser PUT to the signed URL |
| `apps/worker/src/storage.ts` (create), `export.ts`, `video.ts`, `handlers.ts`, `bundle.ts`, `index.ts` (modify) | worker on S3, staging path, fonts in bundles |
| `packages/document/src/fontCatalog.ts` + `fontCatalog.json` (create) | catalogue, system families, `isReservedFamily`, `matchWeight`, `cleanFamilyName` |
| `packages/document/scripts/gen-font-catalog.ts` (create) | builds the catalogue from Next's bundled Google metadata |
| `packages/document/src/docFonts.ts` (create) | `docFontFamilies(doc)` |
| `packages/document/src/gradient.ts`, `richText.ts`, `brand.ts`, `copyFormulas.ts`, `styles.ts` (create) | pure logic |
| `packages/document/src/doc.ts`, `artboard.ts`, `bundle.ts`, `readiness.ts`, `index.ts` (modify) | schema, types, bundle fonts, `contentChecks` |
| `packages/db/src/assetCheck.ts`, `schema.ts` (modify), `fontParse.ts` (create) | font sniffing, `FontMeta`, `Brand.palette`, sandboxed parse |
| `packages/renderer/src/fonts.tsx`, `board.ts`, `BoardView.tsx`, `VideoFrame.tsx`, `index.ts` (modify), `extras.ts` (create) | font faces, italic axis, brand resolution, `RenderExtras` |
| `packages/renderer/src/osg/lib/{fontService,textFit,deviceRegistry}.ts`, `osg/elements/{TextElement,deviceChrome}.tsx`, `osg/i18n/project.ts` (modify) | catalogue, `ensureFont`, marks, CarPlay, locale marks |
| `apps/web/src/server/fonts.ts`, `renderExtras.ts` (create) | font list/delete/quota/faces; render input |
| `apps/web/src/app/api/fonts/route.ts`, `api/fonts/[assetId]/route.ts` (create) | font API |
| `apps/web/src/editor/fontPickerModel.ts` (create), `ui/FontPicker.tsx`, `ui/FontUploadDialog.tsx`, `ui/RichTextToolbar.tsx`, `ui/HeadlineIdeas.tsx`, `ui/StylePicker.tsx` (create) | editor UI |
| `apps/web/src/components/PaletteGrid.tsx`, `apps/web/src/lib/colorExtract.ts` (create) | palette editing and extraction |
| `apps/web/src/editor/commands.ts`, `assets.tsx`, `ui/{Inspector,LeftPanel,fields,Canvas,Checks,Toolbar}.tsx`, `components/{BrandForm,RenderSheet,VideoSheet,BoardThumb,ProjectBoards,StorePreview,VideoPanel,ExportDialog}.tsx` (modify) | wiring |
| `apps/worker/scripts/gen-style-previews.ts` (create), `apps/web/public/styles/*.png` (generated) | style preview images |
| `packages/db/test/fixtures/fonts/*` (create, downloaded once) | OFL font fixtures |

**Path rulings (spec says `scripts/…` at the repo root, which does not exist):** each script lives in the package that owns its dependencies, following `packages/document/scripts/`. `s3-setup.ts` goes in `packages/storage/scripts/`, `gen-font-catalog.ts` in `packages/document/scripts/` and `gen-style-previews.ts` in `apps/worker/scripts/`. The catalogue JSON lives in `packages/document/src/fontCatalog.json`, not `packages/renderer/src/osg/lib/`. The worker's bundle import must apply the same family-collision rule, and the worker depends on `@chitrapx/document` but not on the renderer.

---

### Task 1: `packages/storage`, MinIO and bucket setup

**Files:**
- Create: `packages/storage/package.json`, `packages/storage/tsconfig.json`, `packages/storage/vitest.config.ts`
- Create: `packages/storage/src/types.ts`, `src/config.ts`, `src/memory.ts`, `src/s3.ts`, `src/setup.ts`, `src/index.ts`
- Create: `packages/storage/scripts/s3-setup.ts`
- Create: `packages/storage/test/contract.ts`, `test/memory.test.ts`, `test/s3.test.ts`
- Create: `docker-compose.yml`
- Modify: `package.json` (root scripts), `.env.example`, `README.md` (Local setup)

**Interfaces:**
- Produces (all exported from `@chitrapx/storage`):
  - `type Bucket = "uploads" | "exports"`, `UPLOADS_BUCKET`, `EXPORTS_BUCKET`
  - `class ObjectMissingError extends Error { path: string }`
  - `interface ObjectStorage`:
    - `presignPut(path, { contentType, contentLength, bucket? }): Promise<{ url: string; headers: Record<string, string> }>`
    - `download(path, bucket?): Promise<Buffer>` and `downloadStream(path, bucket?): Promise<ReadableStream<Uint8Array>>`. Both throw `ObjectMissingError` when the object is missing.
    - `put(path, bytes: Uint8Array, contentType, bucket?): Promise<void>`
    - `remove(path, bucket?): Promise<void>` and `exists(path, bucket?): Promise<boolean>`
    - `move(from, to, opts?: { contentType?: string; bucket?: Bucket }): Promise<void>`. Fails if `to` exists. `contentType` replaces the stored type.
    - `signedUrls(paths, bucket?): Promise<string[]>` (1 hour)
    - `signedDownload(path, filename, bucket = "exports"): Promise<string>` (5 minutes)
    - `bucket` defaults to `"uploads"` everywhere except `signedDownload`.
  - `type StorageConfig`, `storageConfig(env?): StorageConfig`, `storageOrigin(bucket?, config?): string`, `s3Storage(config?): ObjectStorage`
  - `class MemoryStorage implements ObjectStorage { files: Map<string, Buffer>; signed: string[]; readBytes: number }` and `memoryStorage(): MemoryStorage`. Files are keyed `"<bucket>/<path>"`. Its URLs look like `memory://<bucket>/<path>`.
  - `ensureBuckets(config, webOrigin): Promise<string[]>` and `EXPORT_RETENTION_DAYS = 30`
  - `STAGING_PREFIX = "staging/"`

> **Ruling (export retention):** the spec says "the retention period the export code already uses". No retention exists anywhere in the code, so this task introduces `EXPORT_RETENTION_DAYS = 30`. A download link for an export older than 30 days will 404.
>
> **Ruling (staging path):** lifecycle rules filter by key prefix. Staging objects therefore move from `<ws>/staging/<id>` to `staging/<ws>/<id>`. Tasks 2 and 3 update `stagingPath` and the worker import to match.

- [ ] **Step 1: Package scaffolding**

`packages/storage/package.json`:

```json
{
  "name": "@chitrapx/storage",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc",
    "test": "vitest run",
    "setup": "tsx --env-file-if-exists=../../.env scripts/s3-setup.ts"
  },
  "dependencies": {},
  "devDependencies": { "tsx": "^4.23.15" }
}
```

`packages/storage/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"], "lib": ["ES2023", "DOM"] }, "include": ["src", "test", "scripts", "*.ts"] }
```

`packages/storage/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

try { process.loadEnvFile("../../.env"); } catch { /* CI sets env directly */ }

export default defineConfig({ test: { fileParallelism: false, testTimeout: 20_000 } });
```

Then install the two allowed dependencies (this pins the current versions in the lockfile):

Run: `pnpm --filter @chitrapx/storage add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`
Expected: both appear under `dependencies` in `packages/storage/package.json`.

- [ ] **Step 2: MinIO and environment**

`docker-compose.yml` at the repo root (the Chainguard MinIO image is already pulled on the dev machine; its entrypoint is `/usr/bin/minio`):

```yaml
# Local S3 for dev and e2e. Console: http://127.0.0.1:9001 (user chitrapx / chitrapx-dev-secret).
services:
  minio:
    image: cgr.dev/chainguard/minio:latest
    user: "0:0" # the named volume is root-owned
    command: ["server", "/data", "--console-address", ":9001"]
    ports: ["9000:9000", "9001:9001"]
    environment:
      MINIO_ROOT_USER: chitrapx
      MINIO_ROOT_PASSWORD: chitrapx-dev-secret
      # MinIO answers PutBucketCors with NotImplemented; its CORS comes from here instead.
      MINIO_API_CORS_ALLOW_ORIGIN: http://localhost:3000
    volumes: ["minio-data:/data"]
volumes:
  minio-data:
```

Append to `.env.example`:

```bash
# Object storage: AWS S3, Cloudflare R2 or MinIO. Local: `pnpm storage:up && pnpm storage:setup`
# Leave S3_ENDPOINT empty for AWS. R2: https://<account>.r2.cloudflarestorage.com
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=chitrapx
S3_SECRET_ACCESS_KEY=chitrapx-dev-secret
S3_BUCKET_UPLOADS=chitrapx-uploads
S3_BUCKET_EXPORTS=chitrapx-exports
# true for MinIO (path-style URLs)
S3_FORCE_PATH_STYLE=true
```

Copy the same lines into your local `.env` (it is gitignored). Add these root `package.json` scripts:

```json
"storage:up": "docker compose up -d minio",
"storage:setup": "pnpm --filter @chitrapx/storage setup"
```

Run: `pnpm storage:up && sleep 3 && curl -sf http://127.0.0.1:9000/minio/health/live && echo up`
Expected: `up`.

- [ ] **Step 3: Write the contract tests (failing)**

`packages/storage/test/contract.ts`:

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ObjectMissingError, type ObjectStorage } from "../src/index.ts";

const read = async (s: ReadableStream<Uint8Array>) => {
  const chunks: Uint8Array[] = [];
  const r = s.getReader();
  for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value); }
  return Buffer.concat(chunks);
};

/** Behaviour every ObjectStorage must have. `http` = its URLs are real and fetchable. */
export function storageContract(name: string, make: () => ObjectStorage, http: boolean) {
  describe(`${name}: object storage contract`, () => {
    const key = () => `test/${randomUUID()}/obj`;

    it("puts, reads back, streams, checks and removes an object", async () => {
      const s = make(); const k = key(); const bytes = Buffer.from("hello storage");
      expect(await s.exists(k)).toBe(false);
      await s.put(k, bytes, "text/plain");
      expect(await s.exists(k)).toBe(true);
      expect(Buffer.from(await s.download(k))).toEqual(bytes);
      expect(await read(await s.downloadStream(k))).toEqual(bytes);
      await s.remove(k);
      expect(await s.exists(k)).toBe(false);
    });

    it("reports a missing object as ObjectMissingError", async () => {
      const s = make();
      await expect(s.download(key())).rejects.toBeInstanceOf(ObjectMissingError);
      await expect(s.downloadStream(key())).rejects.toBeInstanceOf(ObjectMissingError);
    });

    it("move refuses an existing target, otherwise moves", async () => {
      const s = make(); const a = key(), b = key();
      await s.put(a, Buffer.from("a"), "text/plain");
      await s.put(b, Buffer.from("b"), "text/plain");
      await expect(s.move(a, b)).rejects.toThrow();
      expect((await s.download(b)).toString()).toBe("b");
      await s.remove(b);
      await s.move(a, b, { contentType: "font/woff2" });
      expect(await s.exists(a)).toBe(false);
      expect((await s.download(b)).toString()).toBe("a");
    });

    it("keeps the two buckets apart", async () => {
      const s = make(); const k = key();
      await s.put(k, Buffer.from("x"), "application/zip", "exports");
      expect(await s.exists(k)).toBe(false);
      expect(await s.exists(k, "exports")).toBe(true);
    });

    if (http) {
      it("signed GET URLs serve the object", async () => {
        const s = make(); const k = key();
        await s.put(k, Buffer.from("served"), "text/plain");
        const [url] = await s.signedUrls([k]);
        expect(await (await fetch(url!)).text()).toBe("served");
      });

      it("a presigned PUT creates the object once, at exactly the signed size", async () => {
        const s = make(); const k = key(); const body = Buffer.from("x".repeat(100));
        const { url, headers } = await s.presignPut(k, { contentType: "application/octet-stream", contentLength: body.length });
        expect((await fetch(url, { method: "PUT", headers, body: body.subarray(0, 50) })).ok).toBe(false); // size mismatch
        expect((await fetch(url, { method: "PUT", headers, body })).status).toBe(200);
        expect((await fetch(url, { method: "PUT", headers, body })).ok).toBe(false); // If-None-Match: * — never overwrites
        expect(Buffer.from(await s.download(k))).toEqual(body);
      });

      it("signedDownload asks the browser to save under the given name", async () => {
        const s = make(); const k = key();
        await s.put(k, Buffer.from("zip"), "application/zip", "exports");
        const res = await fetch(await s.signedDownload(k, "chitrapx-export.zip"));
        expect(res.headers.get("content-disposition")).toContain('filename="chitrapx-export.zip"');
      });
    }
  });
}
```

`packages/storage/test/memory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { memoryStorage } from "../src/index.ts";
import { storageContract } from "./contract.ts";

storageContract("memory", () => memoryStorage(), false);

describe("memoryStorage", () => {
  it("records presigned paths and hands out memory:// URLs", async () => {
    const s = memoryStorage();
    const { url, headers } = await s.presignPut("staging/w/u", { contentType: "image/png", contentLength: 3 });
    expect(url).toBe("memory://uploads/staging/w/u?put");
    expect(headers).toEqual({ "Content-Type": "image/png", "If-None-Match": "*" });
    expect(s.signed).toEqual(["staging/w/u"]);
    expect(await s.signedUrls(["w/abc"])).toEqual(["memory://uploads/w/abc"]);
  });
});
```

`packages/storage/test/s3.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { ensureBuckets, s3Storage, storageConfig, storageOrigin, type StorageConfig } from "../src/index.ts";
import { storageContract } from "./contract.ts";

beforeAll(async () => {
  const live = await fetch(`${process.env.S3_ENDPOINT}/minio/health/live`).catch(() => null);
  if (!live?.ok) throw new Error("MinIO not reachable at S3_ENDPOINT; run pnpm storage:up && pnpm storage:setup");
  await ensureBuckets(storageConfig(), process.env.WEB_ORIGIN ?? "http://localhost:3000");
});

storageContract("s3 (MinIO)", () => s3Storage(), true);

describe("storage config and origin", () => {
  it("signed URLs point at storageOrigin()", async () => {
    const [url] = await s3Storage().signedUrls(["any/key"]);
    expect(new URL(url!).origin).toBe(storageOrigin());
  });
  it("names the missing variable", () => {
    expect(() => storageConfig({ S3_REGION: "eu-west-1" })).toThrow(/S3_ACCESS_KEY_ID/);
  });
  it("uses the AWS virtual-host origin per bucket when there is no endpoint", () => {
    const aws: StorageConfig = { region: "eu-west-1", accessKeyId: "a", secretAccessKey: "b", forcePathStyle: false, buckets: { uploads: "u-bkt", exports: "e-bkt" } };
    expect(storageOrigin("uploads", aws)).toBe("https://u-bkt.s3.eu-west-1.amazonaws.com");
    expect(storageOrigin("uploads", { ...aws, forcePathStyle: true })).toBe("https://s3.eu-west-1.amazonaws.com");
    expect(storageOrigin("uploads", { ...aws, endpoint: "https://acc.r2.cloudflarestorage.com", forcePathStyle: true })).toBe("https://acc.r2.cloudflarestorage.com");
  });
});
```

Run: `pnpm --filter @chitrapx/storage exec vitest run`
Expected: FAIL. `../src/index.ts` does not exist.

- [ ] **Step 4: Types, config and the memory store**

`packages/storage/src/types.ts`:

```ts
export type Bucket = "uploads" | "exports";
export const UPLOADS_BUCKET: Bucket = "uploads";
export const EXPORTS_BUCKET: Bucket = "exports";
/** Client uploads land here first; a lifecycle rule deletes leftovers after a day. */
export const STAGING_PREFIX = "staging/";

export class ObjectMissingError extends Error {
  constructor(public path: string) { super(`object missing: ${path}`); this.name = "ObjectMissingError"; }
}

/** All object storage Chitrapx uses: S3/R2/MinIO in production, in memory in tests. */
export interface ObjectStorage {
  /** A 10-minute URL that creates `path` once, at exactly `contentLength` bytes. Send `headers` with the PUT. */
  presignPut(path: string, opts: { contentType: string; contentLength: number; bucket?: Bucket }): Promise<{ url: string; headers: Record<string, string> }>;
  download(path: string, bucket?: Bucket): Promise<Buffer>;
  /** The object as a stream, so large files are never held in memory. */
  downloadStream(path: string, bucket?: Bucket): Promise<ReadableStream<Uint8Array>>;
  put(path: string, bytes: Uint8Array, contentType: string, bucket?: Bucket): Promise<void>;
  remove(path: string, bucket?: Bucket): Promise<void>;
  exists(path: string, bucket?: Bucket): Promise<boolean>;
  /** Fails if `to` already exists. `contentType` replaces the stored type (validated uploads get their sniffed type). */
  move(from: string, to: string, opts?: { contentType?: string; bucket?: Bucket }): Promise<void>;
  /** 1-hour GET links, in order. */
  signedUrls(paths: string[], bucket?: Bucket): Promise<string[]>;
  /** A 5-minute link that downloads `path` (exports bucket by default) under `filename`. */
  signedDownload(path: string, filename: string, bucket?: Bucket): Promise<string>;
}
```

`packages/storage/src/config.ts`:

```ts
import type { Bucket } from "./types.ts";

export type StorageConfig = {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  buckets: Record<Bucket, string>;
  forcePathStyle: boolean;
};

/** Reads the S3 settings; throws naming the first missing variable, so a misconfigured deploy fails at startup. */
export function storageConfig(env: Record<string, string | undefined> = process.env): StorageConfig {
  const need = (k: string) => {
    const v = env[k]?.trim();
    if (!v) throw new Error(`Missing environment variable ${k} (object storage, see .env.example)`);
    return v;
  };
  return {
    endpoint: env.S3_ENDPOINT?.trim() || undefined,
    region: need("S3_REGION"),
    accessKeyId: need("S3_ACCESS_KEY_ID"),
    secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
    buckets: { uploads: need("S3_BUCKET_UPLOADS"), exports: need("S3_BUCKET_EXPORTS") },
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
  };
}

/** The origin signed URLs for `bucket` point at; the export browser allow-lists it. */
export function storageOrigin(bucket: Bucket = "uploads", config: StorageConfig = storageConfig()): string {
  if (config.endpoint) {
    const u = new URL(config.endpoint);
    return config.forcePathStyle ? u.origin : `${u.protocol}//${config.buckets[bucket]}.${u.host}`;
  }
  return config.forcePathStyle
    ? `https://s3.${config.region}.amazonaws.com`
    : `https://${config.buckets[bucket]}.s3.${config.region}.amazonaws.com`;
}
```

`packages/storage/src/memory.ts`:

```ts
import { ObjectMissingError, type Bucket, type ObjectStorage } from "./types.ts";

/** In-memory ObjectStorage for unit tests. Files are keyed "<bucket>/<path>". */
export class MemoryStorage implements ObjectStorage {
  files = new Map<string, Buffer>();
  types = new Map<string, string>();
  /** Every path a PUT was presigned for, in order. */
  signed: string[] = [];
  /** How far the last downloadStream reader got, in bytes. */
  readBytes = 0;
  private k = (path: string, bucket: Bucket = "uploads") => `${bucket}/${path}`;

  async presignPut(path: string, opts: { contentType: string; contentLength: number; bucket?: Bucket }) {
    this.signed.push(path);
    return { url: `memory://${opts.bucket ?? "uploads"}/${path}?put`, headers: { "Content-Type": opts.contentType, "If-None-Match": "*" } };
  }
  async download(path: string, bucket?: Bucket) {
    const f = this.files.get(this.k(path, bucket));
    if (!f) throw new ObjectMissingError(path);
    return f;
  }
  async downloadStream(path: string, bucket?: Bucket) {
    const f = await this.download(path, bucket);
    let at = 0;
    this.readBytes = 0;
    return new ReadableStream<Uint8Array>({
      pull: (c) => {
        if (at >= f.length) { c.close(); return; }
        const chunk = f.subarray(at, at + 65536); at += chunk.length; this.readBytes = at; c.enqueue(chunk);
      },
    });
  }
  async put(path: string, bytes: Uint8Array, contentType: string, bucket?: Bucket) {
    this.files.set(this.k(path, bucket), Buffer.from(bytes));
    this.types.set(this.k(path, bucket), contentType);
  }
  async remove(path: string, bucket?: Bucket) { this.files.delete(this.k(path, bucket)); this.types.delete(this.k(path, bucket)); }
  async exists(path: string, bucket?: Bucket) { return this.files.has(this.k(path, bucket)); }
  async move(from: string, to: string, opts: { contentType?: string; bucket?: Bucket } = {}) {
    const src = this.k(from, opts.bucket), dst = this.k(to, opts.bucket);
    const f = this.files.get(src);
    if (!f) throw new ObjectMissingError(from);
    if (this.files.has(dst)) throw new Error(`move target exists: ${to}`);
    this.files.set(dst, f); this.types.set(dst, opts.contentType ?? this.types.get(src) ?? "application/octet-stream");
    this.files.delete(src); this.types.delete(src);
  }
  async signedUrls(paths: string[], bucket: Bucket = "uploads") { return paths.map((p) => `memory://${bucket}/${p}`); }
  async signedDownload(path: string, filename: string, bucket: Bucket = "exports") { return `memory://${bucket}/${path}?download=${encodeURIComponent(filename)}`; }
}

export const memoryStorage = () => new MemoryStorage();
```

- [ ] **Step 5: The S3 store and bucket setup**

`packages/storage/src/s3.ts`:

```ts
import {
  CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { storageConfig, type StorageConfig } from "./config.ts";
import { ObjectMissingError, type Bucket, type ObjectStorage } from "./types.ts";

export function s3Client(config: StorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Default CRC32 checksums would be signed into presigned PUTs, which browsers cannot reproduce; R2/MinIO also reject some.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

const isMissing = (err: unknown) => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
};
const copySource = (bucket: string, key: string) => `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

export function s3Storage(config: StorageConfig = storageConfig()): ObjectStorage {
  const client = s3Client(config);
  const B = (b: Bucket = "uploads") => config.buckets[b];
  const get = async (path: string, bucket?: Bucket) => {
    try { return await client.send(new GetObjectCommand({ Bucket: B(bucket), Key: path })); }
    catch (err) { if (isMissing(err)) throw new ObjectMissingError(path); throw err; }
  };
  const exists = async (path: string, bucket?: Bucket) => {
    try { await client.send(new HeadObjectCommand({ Bucket: B(bucket), Key: path })); return true; }
    catch (err) { if (isMissing(err)) return false; throw err; }
  };
  return {
    async presignPut(path, { contentType, contentLength, bucket }) {
      const cmd = new PutObjectCommand({ Bucket: B(bucket), Key: path, ContentType: contentType, ContentLength: contentLength, IfNoneMatch: "*" });
      const url = await getSignedUrl(client, cmd, { expiresIn: 600, signableHeaders: new Set(["content-type", "content-length", "if-none-match"]) });
      // Content-Length is signed too; browsers set it from the body and may not set it by hand.
      return { url, headers: { "Content-Type": contentType, "If-None-Match": "*" } };
    },
    async download(path, bucket) {
      const res = await get(path, bucket);
      return Buffer.from(await res.Body!.transformToByteArray());
    },
    async downloadStream(path, bucket) {
      const res = await get(path, bucket);
      return res.Body!.transformToWebStream() as ReadableStream<Uint8Array>;
    },
    async put(path, bytes, contentType, bucket) {
      await client.send(new PutObjectCommand({ Bucket: B(bucket), Key: path, Body: bytes, ContentType: contentType }));
    },
    async remove(path, bucket) {
      await client.send(new DeleteObjectCommand({ Bucket: B(bucket), Key: path }));
    },
    exists,
    async move(from, to, opts = {}) {
      if (await exists(to, opts.bucket)) throw new Error(`move target exists: ${to}`);
      try {
        await client.send(new CopyObjectCommand({
          Bucket: B(opts.bucket), Key: to, CopySource: copySource(B(opts.bucket), from),
          ...(opts.contentType ? { MetadataDirective: "REPLACE", ContentType: opts.contentType } : {}),
        }));
      } catch (err) { if (isMissing(err)) throw new ObjectMissingError(from); throw err; }
      await client.send(new DeleteObjectCommand({ Bucket: B(opts.bucket), Key: from }));
    },
    async signedUrls(paths, bucket) {
      return Promise.all(paths.map((p) => getSignedUrl(client, new GetObjectCommand({ Bucket: B(bucket), Key: p }), { expiresIn: 3600 })));
    },
    async signedDownload(path, filename, bucket = "exports") {
      const safe = filename.replace(/["\\\r\n]/g, "");
      return getSignedUrl(client, new GetObjectCommand({ Bucket: B(bucket), Key: path, ResponseContentDisposition: `attachment; filename="${safe}"` }), { expiresIn: 300 });
    },
  };
}
```

`packages/storage/src/setup.ts`:

```ts
import {
  CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand, PutBucketLifecycleConfigurationCommand, type LifecycleRule,
} from "@aws-sdk/client-s3";
import type { StorageConfig } from "./config.ts";
import { s3Client } from "./s3.ts";
import { STAGING_PREFIX, type Bucket } from "./types.ts";

/** Exports (ZIPs, PNGs, MP4s, project files) are deleted this many days after they are written. */
export const EXPORT_RETENTION_DAYS = 30;

const notImplemented = (err: unknown) => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotImplemented" || e?.$metadata?.httpStatusCode === 501;
};

/** Creates both buckets if missing, then (re)applies CORS and lifecycle rules. Idempotent. Returns what it did. */
export async function ensureBuckets(config: StorageConfig, webOrigin: string): Promise<string[]> {
  const client = s3Client(config);
  const log: string[] = [];
  for (const b of ["uploads", "exports"] as Bucket[]) {
    const Bucket = config.buckets[b];
    try { await client.send(new HeadBucketCommand({ Bucket })); }
    catch { await client.send(new CreateBucketCommand({ Bucket })); log.push(`created ${Bucket}`); }
    try {
      await client.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: [{
        AllowedOrigins: [new URL(webOrigin).origin], AllowedMethods: ["PUT", "GET", "HEAD"],
        AllowedHeaders: ["content-type", "content-length", "if-none-match"], MaxAgeSeconds: 3600,
      }] } }));
      log.push(`${Bucket}: CORS for ${webOrigin}`);
    } catch (err) {
      if (!notImplemented(err)) throw err;
      log.push(`${Bucket}: CORS API not supported here (MinIO); set MINIO_API_CORS_ALLOW_ORIGIN instead`);
    }
    const rule: LifecycleRule = b === "uploads"
      ? { ID: "staging-1-day", Status: "Enabled", Filter: { Prefix: STAGING_PREFIX }, Expiration: { Days: 1 } }
      : { ID: `exports-${EXPORT_RETENTION_DAYS}-days`, Status: "Enabled", Filter: { Prefix: "" }, Expiration: { Days: EXPORT_RETENTION_DAYS } };
    await client.send(new PutBucketLifecycleConfigurationCommand({ Bucket, LifecycleConfiguration: { Rules: [rule] } }));
    log.push(`${Bucket}: lifecycle ${rule.ID}`);
  }
  return log;
}
```

`packages/storage/src/index.ts`:

```ts
export * from "./types.ts";
export * from "./config.ts";
export { memoryStorage, MemoryStorage } from "./memory.ts";
export { s3Storage } from "./s3.ts";
export { ensureBuckets, EXPORT_RETENTION_DAYS } from "./setup.ts";
```

`packages/storage/scripts/s3-setup.ts`:

```ts
// Creates the upload and export buckets with CORS and lifecycle rules. Uses the S3_* variables from .env.
// Local: pnpm storage:up && pnpm storage:setup. Production: run once with the production env.
import { ensureBuckets, storageConfig } from "../src/index.ts";

const origin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
for (const line of await ensureBuckets(storageConfig(), origin)) console.log(line);
```

- [ ] **Step 6: Run the tests**

Run: `pnpm storage:setup && pnpm --filter @chitrapx/storage exec vitest run`
Expected: the setup prints `created chitrapx-uploads` and `created chitrapx-exports` (the first time only), then the lifecycle lines. All tests pass.

If `If-None-Match` is not honoured, the second PUT returns 200. That means the MinIO image is too old: pull a newer `cgr.dev/chainguard/minio:latest` and rerun. Do not weaken the test.

- [ ] **Step 7: README local setup**

In `README.md` "Local setup", after `pnpm db:start`, add:

```bash
pnpm storage:up            # MinIO (S3) in Docker on :9000, console on :9001
pnpm storage:setup         # buckets, CORS, lifecycle rules (idempotent)
```

Change the `pnpm db:start` comment to `# local Supabase (Postgres, Auth) in Docker`.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm typecheck`
Expected: only the known `billing.ts:61` error.

```bash
git add packages/storage docker-compose.yml package.json pnpm-lock.yaml .env.example README.md
git commit -m "feat(storage): S3 object storage package with MinIO for dev and e2e"
```

---

### Task 2: Web app on S3

**Files:**
- Modify: `apps/web/package.json` (add `"@chitrapx/storage": "workspace:^"`)
- Modify: `apps/web/src/server/storage.ts` (replace whole file)
- Create: `apps/web/src/instrumentation.ts`
- Modify: `apps/web/src/server/uploads.ts` (sign returns a URL, staging path, `readStaged` helper, move with sniffed type)
- Modify: `apps/web/src/server/imports.ts:21-28` (`signImport`)
- Modify: `apps/web/src/lib/uploadAsset.ts`, `apps/web/src/components/ImportProjectButton.tsx`
- Modify (`supabaseStorage()` → `appStorage()`): `app/editor/[projectId]/page.tsx`, `app/render/[jobId]/page.tsx`, `app/api/jobs/[jobId]/download/route.ts`, `app/api/apps/[appId]/imports/sign/route.ts`, `app/api/apps/[appId]/assets/route.ts`, `app/api/uploads/complete/route.ts`, `app/api/uploads/sign/route.ts`, `app/dashboard/apps/[appId]/page.tsx`, `app/dashboard/projects/[projectId]/page.tsx`, `app/dashboard/projects/[projectId]/preview/page.tsx`
- Modify: `supabase/config.toml` (delete the `[storage.buckets.uploads]` and `[storage.buckets.exports]` stanzas), `README.md` (Deploy)
- Test: `apps/web/test/uploads.test.ts` (adapt), `apps/web/test/uploads.s3.test.ts` (create)

**Interfaces:**
- Consumes: `ObjectStorage`, `memoryStorage`, `s3Storage`, `storageConfig`, `STAGING_PREFIX` (Task 1).
- Produces:
  - `appStorage(): ObjectStorage` from `@/server/storage.ts`, which also re-exports `ObjectStorage`, `UPLOADS_BUCKET` and `EXPORTS_BUCKET`.
  - `stagingPath(ctx, uploadId) = "staging/<workspaceId>/<uploadId>"`
  - `signUpload(ctx, storage, raw): Promise<{ existing: Asset } | { uploadId: string; url: string; headers: Record<string, string> }>`
  - `signImport(...)`: `{ uploadId, url, headers }`
  - `putSigned(signed: { url: string; headers: Record<string, string> }, file: File): Promise<void>` in `@/lib/uploadAsset.ts`. It throws `Error("Upload failed — try again")`.
  - `readStaged(storage, staging, kind, sha256): Promise<{ head: Buffer; size: number }>`. It is internal to uploads.ts and used again by Task 6.

- [ ] **Step 1: Adapt the unit tests to the new sign response (failing)**

In `apps/web/test/uploads.test.ts`:
- Delete the `MemoryStorage` class.
- Import `memoryStorage` from `@chitrapx/storage` and `stagingPath` from `@/server/uploads.ts`.
- In `setup()`, use `storage: memoryStorage()`.
- Replace every `s.storage.files.set(signed.path, X)` with `await stage(s, signed, X)`, and define the helper after `setup()`:

```ts
/** What the browser does with the signed URL: put the bytes at the staging path. */
async function stage(s: Awaited<ReturnType<typeof setup>>, signed: { uploadId: string }, bytes: Buffer) {
  await s.storage.put(stagingPath(s.ctx, signed.uploadId), bytes, "application/octet-stream");
}
```

Then change the first test's assertions to:

```ts
    expect("uploadId" in signed && signed.url).toBe(`memory://uploads/staging/${s.ctx.workspaceId}/${"uploadId" in signed ? signed.uploadId : ""}?put`);
    expect(asset).toMatchObject({ width: 3, height: 2, mime: "image/png", bytes: file.length, storagePath: `${s.ctx.workspaceId}/${sha(file)}` });
    expect(await s.storage.download(`${s.ctx.workspaceId}/${sha(file)}`)).toEqual(file);
    expect(s.storage.types.get(`uploads/${s.ctx.workspaceId}/${sha(file)}`)).toBe("image/png");
    expect(s.storage.signed.every((p) => p.startsWith("staging/"))).toBe(true);
    expect([...s.storage.files.keys()].some((k) => k.includes("staging/"))).toBe(false);
```

In "signs URLs from the workspace and hash", expect `` `memory://uploads/${s.ctx.workspaceId}/${"c".repeat(64)}` ``.

Run: `pnpm --filter @chitrapx/web exec vitest run test/uploads.test.ts`
Expected: FAIL. `signUpload` still calls `storage.signUpload`, which the new storage does not have.

- [ ] **Step 2: `storage.ts`, startup check and server uploads**

Replace `apps/web/src/server/storage.ts`:

```ts
import { s3Storage, type ObjectStorage } from "@chitrapx/storage";

export { EXPORTS_BUCKET, UPLOADS_BUCKET, type ObjectStorage } from "@chitrapx/storage";

let shared: ObjectStorage | null = null;
/** The app's object storage (S3, R2 or MinIO), built once per server process. */
export function appStorage(): ObjectStorage {
  return (shared ??= s3Storage());
}
```

Read `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md` and `.../src-folder.md` first. Then create `apps/web/src/instrumentation.ts`:

```ts
/** Runs once when the server starts: a deploy without storage settings fails here, naming the variable. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { storageConfig } = await import("@chitrapx/storage");
  storageConfig();
}
```

In `apps/web/src/server/uploads.ts`:

```ts
// replace
export const stagingPath = (ctx: Ctx, uploadId: string) => `${ctx.workspaceId}/staging/${uploadId}`;
// with
/** Clients only ever get a URL for a fresh staging key, so they can never touch validated bytes. The prefix carries the 1-day lifecycle rule. */
export const stagingPath = (ctx: Ctx, uploadId: string) => `${STAGING_PREFIX}${ctx.workspaceId}/${uploadId}`;
```

Add `import { STAGING_PREFIX } from "@chitrapx/storage";`. Change the return type of `signUpload` to `Promise<{ existing: Asset } | { uploadId: string; url: string; headers: Record<string, string> }>`. Replace its last two lines:

```ts
  const uploadId = randomUUID();
  return { uploadId, ...(await storage.presignPut(stagingPath(ctx, uploadId), { contentType: input.mime, contentLength: input.size })) };
```

Move the streaming loop out of `completeUpload` into a helper, which Task 6 reuses for fonts:

```ts
/**
 * Streams a staged upload: hash and size are computed as bytes arrive, only the head is kept.
 * On any failure the staging object is removed and an HttpError thrown.
 */
async function readStaged(storage: ObjectStorage, staging: string, kind: UploadKind, expectedSha: string): Promise<{ head: Buffer; size: number }> {
  const discard = () => storage.remove(staging).catch(() => {});
  const reject = async (err: HttpError): Promise<never> => { await discard(); throw err; };
  const stream = await storage.downloadStream(staging).catch(() => { throw badRequest("upload_missing"); });
  const reader = stream.getReader();
  const hash = createHash("sha256");
  const head: Uint8Array[] = [];
  let size = 0, headSize = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > UPLOAD_LIMITS[kind]) { await reader.cancel(); return reject(tooLarge(kind)); }
    hash.update(value);
    if (headSize < HEAD_BYTES[kind]) { head.push(value); headSize += value.byteLength; }
  }
  if (size === 0) return reject(badRequest("unsupported_type"));
  if (hash.digest("hex") !== expectedSha) return reject(badRequest("checksum_mismatch"));
  return { head: Buffer.concat(head), size };
}
```

`completeUpload` then becomes:

```ts
export async function completeUpload(ctx: Ctx, storage: ObjectStorage, raw: unknown): Promise<Asset> {
  const input = completeInput.parse(raw);
  await getApp(ctx, input.appId);
  const staging = stagingPath(ctx, input.uploadId);
  const discard = () => storage.remove(staging).catch(() => {});

  const mine = await findAsset(ctx, input.sha256, input.appId);
  if (mine) { await discard(); return mine; }

  const { head: headBytes, size } = await readStaged(storage, staging, input.kind, input.sha256);
  const sniffed = await sniffAsset(input.kind, headBytes);
  if (!sniffed.ok) { await discard(); throw badRequest(sniffed.code); }

  const sibling = await findAsset(ctx, input.sha256);
  if (sibling) { await discard(); return linkExisting(ctx, input.appId, sibling); }

  const path = finalPath(ctx, input.sha256);
  await storage.remove(path).catch(() => {}); // an unreferenced leftover, e.g. from a deleted app
  await storage.move(staging, path, { contentType: sniffed.mime });
  const [inserted] = await db.insert(schema.assets).values({
    workspaceId: ctx.workspaceId, appId: input.appId, kind: input.kind, storagePath: path, mime: sniffed.mime,
    width: sniffed.width ?? null, height: sniffed.height ?? null, bytes: size, sha256: input.sha256,
    meta: input.kind === "recording" ? { ready: false } : null,
  }).onConflictDoNothing().returning();
  return inserted ?? (await findAsset(ctx, input.sha256, input.appId))!;
}
```

Remove the `ponytail: abandoned staging objects…` comment. The lifecycle rule now deletes those objects.

In `apps/web/src/server/imports.ts`, change `signImport`'s return:

```ts
  return { uploadId, ...(await storage.presignPut(stagingPath(ctx, uploadId), { contentType: "application/zip", contentLength: size })) };
```

In all ten pages and routes listed under Files:
- Replace `import { supabaseStorage } from "@/server/storage.ts"` with `import { appStorage } from "@/server/storage.ts"`.
- Replace every `supabaseStorage()` call with `appStorage()`.

Run: `grep -rn "supabaseStorage\|storage\.from(\|uploadToSignedUrl" apps/web/src`
Expected: no output.

- [ ] **Step 3: Browser PUT**

Replace `apps/web/src/lib/uploadAsset.ts`:

```ts
import { api } from "@/server/api.ts";

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** PUTs the file to a presigned URL with exactly the headers the server signed. */
export async function putSigned(signed: { url: string; headers: Record<string, string> }, file: File): Promise<void> {
  const res = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: file }).catch(() => null);
  if (!res?.ok) throw new Error("Upload failed — try again");
}

type Signed = { existing?: { id: string }; uploadId?: string; url?: string; headers?: Record<string, string> };

/** Signed upload of one file into the app's assets; the server re-checks type, size and checksum. Returns the asset id. */
export async function uploadAsset(appId: string, kind: "screenshot" | "recording", file: File): Promise<{ id: string }> {
  const sha256 = await sha256Hex(file);
  const signed = await api<Signed>("/api/uploads/sign", "POST", { appId, kind, size: file.size, mime: file.type, sha256 });
  if (signed.existing) return { id: signed.existing.id };
  try { await putSigned({ url: signed.url!, headers: signed.headers! }, file); }
  catch (err) { throw new Error(`${file.name}: ${(err as Error).message}`); }
  const asset = await api<{ id: string }>("/api/uploads/complete", "POST", { appId, kind, sha256, uploadId: signed.uploadId });
  return { id: asset.id };
}
```

In `apps/web/src/components/ImportProjectButton.tsx`:
- Drop the `createClient` import and import `putSigned` from `@/lib/uploadAsset.ts`.
- Replace the two upload lines with:

```ts
      const signed = await api<{ uploadId: string; url: string; headers: Record<string, string> }>(`/api/apps/${appId}/imports/sign`, "POST", { size: file.size });
      await putSigned(signed, file);
```

- [ ] **Step 4: Integration test against MinIO**

`apps/web/test/uploads.s3.test.ts`:

```ts
import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureBuckets, s3Storage, storageConfig } from "@chitrapx/storage";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { createApp } from "@/server/apps.ts";
import type { Ctx } from "@/server/context.ts";
import { completeUpload, signUpload } from "@/server/uploads.ts";

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

beforeAll(async () => { await ensureBuckets(storageConfig(), process.env.WEB_ORIGIN ?? "http://localhost:3000"); });

describe("uploads through real S3 (MinIO)", () => {
  it("sign → PUT → complete stores validated bytes; the same URL cannot be used twice; a size lie is refused", async () => {
    const user = await createUser();
    const ctx: Ctx = { userId: user.id, workspaceId: await makeWorkspace(user.id), plan: "free" };
    const app = await createApp(ctx, { name: "S3" });
    const storage = s3Storage();
    const file = png(4, 3);
    const signed = await signUpload(ctx, storage, { appId: app.id, kind: "screenshot", size: file.length, mime: "image/png", sha256: sha(file) });
    if (!("uploadId" in signed)) throw new Error("expected a presigned URL");
    expect((await fetch(signed.url, { method: "PUT", headers: signed.headers, body: Buffer.concat([file, Buffer.from("x")]) })).ok).toBe(false);
    expect((await fetch(signed.url, { method: "PUT", headers: signed.headers, body: file })).status).toBe(200);
    expect((await fetch(signed.url, { method: "PUT", headers: signed.headers, body: file })).ok).toBe(false);
    const asset = await completeUpload(ctx, storage, { appId: app.id, kind: "screenshot", sha256: sha(file), uploadId: signed.uploadId });
    expect(asset).toMatchObject({ width: 4, height: 3, mime: "image/png" });
    expect(await storage.download(`${ctx.workspaceId}/${sha(file)}`)).toEqual(file);
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @chitrapx/web exec vitest run test/uploads.test.ts test/uploads.s3.test.ts test/templates.test.ts test/jobs.test.ts`
Expected: PASS.

- [ ] **Step 6: Config and docs**

- In `supabase/config.toml`, delete the `[storage.buckets.uploads]` and `[storage.buckets.exports]` stanzas and their comments.
- In `README.md` "Deploy", replace the Supabase "Storage: private buckets…" bullet with this new item 0:

```markdown
0. **Object storage** (AWS S3, Cloudflare R2 or any S3-compatible service)
   - Set `S3_*` (see `.env.example`) on web and worker, then run `WEB_ORIGIN=<web origin> pnpm storage:setup` once.
   - It creates both buckets, CORS for the web origin, a 1-day rule for `staging/` uploads and a 30-day rule for exports.
```

- Also add `S3_*` to the env lists of the Web and Worker items.

- [ ] **Step 7: Manual check, typecheck, commit**

Start the web dev server in the background:

```bash
cd apps/web && (nohup ./node_modules/.bin/next dev > /tmp/chitrapx-web.log 2>&1 & echo $! > /tmp/chitrapx-web.pid); cd ../..
for i in $(seq 1 60); do curl -sf http://localhost:3000/api/health > /dev/null && break; sleep 2; done
```

In a browser, upload a screenshot on an app page and import a `.chitrapx` file. Both must succeed. Then stop the server with `kill "$(cat /tmp/chitrapx-web.pid)"`.

Run: `pnpm typecheck && pnpm lint`
Expected: only `billing.ts:61`.

```bash
git add apps/web supabase/config.toml README.md pnpm-lock.yaml
git commit -m "feat(web): uploads, imports and downloads on S3 presigned URLs"
```

---

### Task 3: Worker on S3

**Files:**
- Modify: `apps/worker/package.json` (add `"@chitrapx/storage": "workspace:^"`, remove `@supabase/supabase-js`)
- Create: `apps/worker/src/storage.ts`
- Modify: `apps/worker/src/export.ts`, `video.ts`, `handlers.ts`, `bundle.ts` (staging path in `runImport` and `cleanupFailedImport`), `index.ts`
- Modify: `apps/worker/Dockerfile`
- Test: `apps/worker/test/exportUrl.test.ts`, `apps/worker/test/bundle.test.ts` (staging paths), `apps/worker/test-e2e/export.test.ts`

**Interfaces:**
- Consumes: `s3Storage`, `storageOrigin`, `storageConfig`, `ObjectMissingError`, `STAGING_PREFIX` (Task 1).
- Produces:
  - `storage(): ObjectStorage` (worker singleton) from `apps/worker/src/storage.ts`
  - `exportOrigins()` now holds `[WEB_ORIGIN, storageOrigin("uploads"), Google Fonts origins]`
  - Bundle staging key `staging/<ws>/<uploadId>`
  - `EXPORTS_BUCKET` is no longer exported from `export.ts`. Import it from `@chitrapx/storage`.

- [ ] **Step 1: Point the tests at the new storage (failing)**

In `apps/worker/test/exportUrl.test.ts`, replace the Supabase origin `http://127.0.0.1:54321` with `http://127.0.0.1:9000`. Replace the URL `http://127.0.0.1:54321/storage/v1/object/sign/uploads/a` with `http://127.0.0.1:9000/chitrapx-uploads/w/abc?X-Amz-Signature=1`. Then add:

```ts
  it("exportOrigins allows exactly the web app, the uploads bucket and Google Fonts", async () => {
    const { exportOrigins } = await import("../src/export.ts");
    const { storageOrigin } = await import("@chitrapx/storage");
    expect(exportOrigins()).toEqual([new URL(process.env.WEB_ORIGIN ?? "http://localhost:3000").origin, storageOrigin("uploads"), "https://fonts.googleapis.com", "https://fonts.gstatic.com"]);
  });
```

In `apps/worker/test/bundle.test.ts`, change every staging key `` `${ws}/staging/${...}` `` to `` `staging/${ws}/${...}` ``.

Run: `grep -n "staging" apps/worker/test/bundle.test.ts` to find them all, then `pnpm --filter @chitrapx/worker exec vitest run test/exportUrl.test.ts test/bundle.test.ts`.
Expected: FAIL. `exportOrigins` still lists the Supabase URL, and the import reads the old staging key.

- [ ] **Step 2: Worker storage**

`apps/worker/src/storage.ts`:

```ts
import { s3Storage, type ObjectStorage } from "@chitrapx/storage";

let shared: ObjectStorage | null = null;
/** The worker's object storage, built once. */
export const storage = (): ObjectStorage => (shared ??= s3Storage());
```

In `apps/worker/src/export.ts`:
- Delete the `createClient` import, `EXPORTS_BUCKET` and the `storage` helper.
- Import `{ storageOrigin } from "@chitrapx/storage"` and `{ storage } from "./storage.ts"`.
- Change `exportOrigins` to:

```ts
export function exportOrigins(): string[] {
  return [process.env.WEB_ORIGIN ?? "http://localhost:3000", storageOrigin("uploads"), "https://fonts.googleapis.com", "https://fonts.gstatic.com"]
    .map((o) => new URL(o).origin);
}
```

Replace both uploads in `runExport`:

```ts
    await storage().put(path, only, "image/png", "exports");
// and
  await storage().put(path, zip, "application/zip", "exports");
```

In `apps/worker/src/video.ts`, drop the `createClient` import and the `EXPORTS_BUCKET` import, import `{ storage } from "./storage.ts"`, and replace the upload block with `await storage().put(path, bytes, "video/mp4", "exports");`.

In `apps/worker/src/handlers.ts`:
- Delete the `createClient` import and the `uploadsBucket` and `storageApi` helpers.
- Import `{ ObjectMissingError } from "@chitrapx/storage"` and `{ storage } from "./storage.ts"`.
- Then:

```ts
// aiDeps(): loadAsset
    async loadAsset(workspaceId, sha256) {
      try { return await storage().download(`${workspaceId}/${sha256}`); }
      catch (err) { if (err instanceof ObjectMissingError) throw new FatalJobError(`asset_missing:${sha256.slice(0, 12)}`); throw err; }
    },

/** Recordings can be 500 MB: streamed to disk, never buffered. */
const recordingDeps: RecordingDeps = {
  async download(workspaceId, sha256, dest) {
    const body = await storage().downloadStream(`${workspaceId}/${sha256}`).catch((err) => {
      throw err instanceof ObjectMissingError ? new FatalJobError("asset_missing") : err;
    });
    await pipeline(Readable.fromWeb(body as unknown as WebReadableStream), createWriteStream(dest));
  },
  async upload(path, file, contentType) {
    await storage().put(path, await readFile(file), contentType);
  },
};

export const bundleDeps: BundleDeps = {
  async download(path) {
    try { return await storage().download(path); }
    catch (err) {
      // Only a missing object is permanent; other storage errors may clear on retry.
      if (err instanceof ObjectMissingError) throw new FatalJobError(`asset_missing:${path.split("/").pop()!.slice(0, 12)}`);
      throw err;
    }
  },
  async upload(path, bytes, contentType, bucket) { await storage().put(path, bytes, contentType, bucket); },
  async remove(path) { await storage().remove(path); },
};
```

In `apps/worker/src/bundle.ts`, add `import { STAGING_PREFIX } from "@chitrapx/storage";`. Then make these two changes:

```ts
// runImport: the staging key
  const staging = `${STAGING_PREFIX}${job.workspaceId}/${input.uploadId}`;
// cleanupFailedImport: the key it removes
  if (uploadId.success) await deps.remove(`${STAGING_PREFIX}${job.workspaceId}/${uploadId.data}`).catch(() => {});
```

In `apps/worker/src/index.ts`, add as the first lines after the imports:

```ts
import { storageConfig } from "@chitrapx/storage";
storageConfig(); // a worker without storage settings stops here, naming the variable
```

Add the storage package to `apps/worker/Dockerfile`, next to the other packages:

```dockerfile
COPY packages/storage/package.json packages/storage/
# ...
COPY packages/storage packages/storage
```

Run: `pnpm --filter @chitrapx/worker remove @supabase/supabase-js && pnpm --filter @chitrapx/worker add @chitrapx/storage@workspace:^`, then `grep -rn "supabase" apps/worker/src`.
Expected: no output.

- [ ] **Step 3: Unit tests pass**

Run: `pnpm --filter @chitrapx/worker test`
Expected: PASS.

- [ ] **Step 4: E2E helpers on S3**

In `apps/worker/test-e2e/export.test.ts`:
- Delete the `createClient` import, the `storageApi` helper and every `createClient(…)…storage` expression.
- Import `{ EXPORTS_BUCKET } from "@chitrapx/storage"` and `{ storage } from "../src/storage.ts"`, and remove `EXPORTS_BUCKET` from the `../src/export.ts` import.
- Then:

```ts
async function zipFiles(ws: string, jobId: string): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await storage().download(`${ws}/${jobId}.zip`, EXPORTS_BUCKET)));
}
```

Rewrite each download and upload in the file the same way:
- `storageApi().from(EXPORTS_BUCKET).download(p)` → `await storage().download(p, EXPORTS_BUCKET)`. The result is a `Buffer`, so drop the `.arrayBuffer()` wrapping and the `if (error) throw error;` lines.
- `uploads.upload(p, bytes, { contentType })` → `await storage().put(p, bytes, contentType)`.
- The bundle import staging key becomes `` `staging/${ws}/${uploadId}` ``.

Run: `grep -n "createClient\|storageApi\|\.from(" apps/worker/test-e2e/export.test.ts`
Expected: no output.

- [ ] **Step 5: Run the e2e suite. Every golden must stay unchanged**

```bash
pnpm storage:up && pnpm storage:setup
cd apps/web && (nohup ./node_modules/.bin/next dev > /tmp/chitrapx-web.log 2>&1 & echo $! > /tmp/chitrapx-web.pid); cd ../..
for i in $(seq 1 60); do curl -sf http://localhost:3000/api/health > /dev/null && break; sleep 2; done
pnpm --filter @chitrapx/worker test:e2e
kill "$(cat /tmp/chitrapx-web.pid)"
```

Expected: PASS, with no `UPDATE_GOLDEN`. A failing golden here means the render page cannot reach MinIO. Check `exportOrigins()` and the bucket CORS.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: only `billing.ts:61`.

```bash
git add apps/worker pnpm-lock.yaml
git commit -m "feat(worker): exports, videos, bundles and recordings on S3; staging under staging/"
```

---

### Task 4: Font catalogue, lazy loading and the italic axis

**Files:**
- Create: `packages/document/scripts/gen-font-catalog.ts`, `packages/document/src/fontCatalog.json` (generated, committed), `packages/document/src/fontCatalog.ts`
- Modify: `packages/document/src/index.ts`, `packages/document/package.json` (script `gen-font-catalog`)
- Modify: `packages/renderer/src/osg/lib/fontService.ts`, `packages/renderer/src/fonts.tsx`, `packages/renderer/src/index.ts`
- Test: `packages/document/test/fontCatalog.test.ts` (create), `packages/renderer/test/fonts.test.ts` (create), `packages/renderer/test/boardView.test.tsx` (update the `googleFontsHref` call)
- Golden images: `packages/assets/golden/amoura-dating.png`, `single-amoura-02.png` and `status-bar-ios.png` are regenerated (see Step 8)

**Interfaces:**
- Produces (from `@chitrapx/document`):
  - `type FontCategory = "sans-serif" | "serif" | "display" | "handwriting" | "monospace"`
  - `type FontScript = "latin" | "arabic" | "urdu" | "hebrew" | "cjk" | "thai" | "devanagari" | "bengali" | "multilingual"`
  - `type FontFormat = "ttf" | "otf" | "woff" | "woff2"`
  - `type CatalogFont = { family: string; category: FontCategory; weights: number[]; italics: boolean; scripts: FontScript[] }`. `scripts[0]` is the primary script.
  - `FONT_CATALOG: CatalogFont[]`, `SYSTEM_FAMILIES: ReadonlyArray<{ family: string; category: FontCategory }>`
  - `catalogFont(family): CatalogFont | undefined`, `isReservedFamily(family): boolean`, `isSystemOrGeneric(family): boolean`
  - `matchWeight(have: readonly number[], want: number): number` (CSS Fonts 4 matching), `parseWeight(w: string | number | undefined): number`
  - `cleanFamilyName(raw: string): string`, `FONT_FAMILY_UNSAFE: RegExp`
- Produces (from `@chitrapx/renderer`):
  - `type FontFace = { weight: number; italic: boolean }` and `type FontUse = { family: string; faces: FontFace[] }`
  - `fontUsesOf(boards): FontUse[]`, `fontFamiliesOf(boards): string[]`
  - `googleFontsHref(uses: FontUse[]): string | null`. It now takes `FontUse[]` instead of `string[]`, and requests catalogue families only.
  - `ensureFont(family, weight = 400, italic = false): Promise<void>`
  - `GOOGLE_FONTS`, `SYSTEM_FONTS` and `ALL_FONTS` are now derived from the catalogue.

> **Ruling (metadata source):** the Google Fonts API needs a key. The generator therefore reads `font-data.json`, which Next.js ships inside `next/dist/compiled/@next/font/dist/google/`. It lists weights, styles and subsets for 1,942 families. The script supplies a curated family list with categories, plus a script override for non-Latin families.
>
> **Ruling (unknown families):** `googleFontsHref` no longer sends families that are not in the catalogue. Before, it sent them bare. Google rejects the whole css2 request when one family is unknown, so an uploaded family such as "Pacifico (custom)" would have broken every Google font on the board. Every family used by the bundled templates is in the catalogue (pinned by a test).
>
> **Fact (goldens):** `amoura-dating` uses Playfair Display at 500 and 700 italic. Until now its italic was synthesised. With the italic axis the true italic face loads, so the three amoura-based goldens change, by design, in the italic words only. `fg-chat-connect.png` and `mac-boardly.png` must not change. This contradicts the spec's "existing goldens unchanged" for those three images.

- [ ] **Step 1: Write the failing tests**

`packages/document/test/fontCatalog.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogFont, cleanFamilyName, FONT_CATALOG, isReservedFamily, matchWeight, parseWeight } from "../src/index.ts";
import { buildCatalog } from "../scripts/gen-font-catalog.ts";

/** GOOGLE_FONTS before SP10: every one must survive into the catalogue. */
const BEFORE = ["Bricolage Grotesque", "Oswald", "Bungee", "Almarai", "Ranchers", "Roboto Flex", "DM Serif Display", "Adamina", "Merriweather Sans", "Calistoga", "Pacifico", "Baloo 2", "Caveat", "Fira Sans Condensed", "Noto Sans", "Anton", "Bebas Neue", "Abril Fatface", "Alfa Slab One", "Lobster", "Righteous", "Titan One", "Luckiest Guy", "Bangers", "Monoton", "Fredoka", "Unbounded", "Dancing Script", "Great Vibes", "Permanent Marker", "Satisfy", "Playfair Display", "Poppins", "Space Grotesk", "Outfit", "Noto Sans Arabic", "Cairo", "Tajawal", "Amiri", "Scheherazade New", "Markazi Text", "IBM Plex Sans Arabic", "Lateef", "Noto Nastaliq Urdu", "Noto Sans Hebrew", "Noto Sans Thai", "Noto Sans Devanagari", "Noto Sans Bengali", "Noto Sans JP", "Noto Sans SC", "Noto Sans TC", "Noto Sans KR", "Noto Serif JP"];

describe("font catalogue", () => {
  it("has 150 to 300 unique families, each with weights, a category and a primary script", () => {
    expect(FONT_CATALOG.length).toBeGreaterThanOrEqual(150);
    expect(FONT_CATALOG.length).toBeLessThanOrEqual(300);
    expect(new Set(FONT_CATALOG.map((f) => f.family)).size).toBe(FONT_CATALOG.length);
    for (const f of FONT_CATALOG) {
      expect(f.weights.length, f.family).toBeGreaterThan(0);
      expect(["sans-serif", "serif", "display", "handwriting", "monospace"]).toContain(f.category);
      expect(f.scripts.length, f.family).toBeGreaterThan(0);
    }
  });
  it("keeps every family the app offered before, with its script", () => {
    for (const family of BEFORE) expect(catalogFont(family), family).toBeDefined();
    expect(catalogFont("Noto Sans JP")!.scripts[0]).toBe("cjk");
    expect(catalogFont("Noto Nastaliq Urdu")!.scripts[0]).toBe("urdu");
    expect(catalogFont("Cairo")!.scripts[0]).toBe("arabic");
    expect(catalogFont("Noto Sans")!.scripts[0]).toBe("multilingual");
    expect(catalogFont("Playfair Display")!.italics).toBe(true);
    expect(catalogFont("Bebas Neue")).toMatchObject({ weights: [400], italics: false });
  });
  it("covers every family the bundled templates use", () => {
    const dir = join(import.meta.dirname, "../../assets/templates");
    for (const file of readdirSync(dir)) {
      JSON.stringify(JSON.parse(readFileSync(join(dir, file), "utf8")), (k, v) => {
        if (k === "fontFamily" && typeof v === "string") expect(isReservedFamily(v), `${file}: ${v}`).toBe(true);
        return v;
      });
    }
  });
  it("matches weights the way CSS does", () => {
    expect(matchWeight([400, 700], 600)).toBe(700);
    expect(matchWeight([400, 700], 500)).toBe(400);
    expect(matchWeight([300, 700], 450)).toBe(300);
    expect(matchWeight([400, 700], 300)).toBe(400);
    expect(matchWeight([100, 200], 900)).toBe(200);
    expect(matchWeight([400], 400)).toBe(400);
  });
  it("parses stored weights", () => {
    expect([parseWeight("normal"), parseWeight("bold"), parseWeight("600"), parseWeight(undefined), parseWeight("bogus"), parseWeight(800)]).toEqual([400, 700, 600, 400, 400, 800]);
  });
  it("reserves catalogue, system and generic names, case-insensitively", () => {
    expect(isReservedFamily("inter")).toBe(true);
    expect(isReservedFamily("Arial")).toBe(true);
    expect(isReservedFamily("sans-serif")).toBe(true);
    expect(isReservedFamily("Acme Brand Sans")).toBe(false);
  });
  it("cleans font names read from untrusted files", () => {
    expect(cleanFamilyName('Evil"; } body{background:url(//e)}')).toBe("Evil body backgroundurle");
    expect(cleanFamilyName("  My\u0000 Font\n Pro ")).toBe("My Font Pro");
    expect(cleanFamilyName("Ünïcode Sans 2")).toBe("Ünïcode Sans 2");
    expect(cleanFamilyName("{}<>;")).toBe("");
    expect(cleanFamilyName("x".repeat(200))).toHaveLength(80);
  });
  it("the generator refuses a misspelt family", () => {
    expect(() => buildCatalog({})).toThrow(/not a Google Fonts family/);
  });
});
```

`packages/renderer/test/fonts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FONT_CATALOG, matchWeight, type ArtboardState } from "@chitrapx/document";
import { fontUsesOf, googleFontsHref } from "../src/index.ts";
import { getRecommendedFontForLanguage } from "../src/osg/lib/fontLanguageMatcher";

const text = (fontFamily: string, extra: Record<string, unknown> = {}) =>
  ({ id: `t-${fontFamily}-${JSON.stringify(extra)}`, type: "text", content: "Hi", fontSize: 40, color: "#000", fontFamily, position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, rotation: 0, scale: 1, ...extra });
const board = (elements: unknown[]) => ({ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, backgroundColor: "#fff", zoom: 1, elements }) as unknown as ArtboardState;

describe("Google Fonts stylesheet", () => {
  it("round-trips every catalogue family", () => {
    for (const f of FONT_CATALOG) {
      const href = googleFontsHref([{ family: f.family, faces: [{ weight: 400, italic: false }] }]);
      expect(href, f.family).toBe(`https://fonts.googleapis.com/css2?family=${f.family.replace(/ /g, "+")}:wght@${matchWeight(f.weights, 400)}&display=block`);
    }
  });
  it("requests ital,wght tuples only for families used in italic", () => {
    expect(googleFontsHref([{ family: "Playfair Display", faces: [{ weight: 700, italic: true }, { weight: 400, italic: false }] }]))
      .toBe("https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;1,700&display=block");
    expect(googleFontsHref([{ family: "Outfit", faces: [{ weight: 600, italic: false }] }]))
      .toBe("https://fonts.googleapis.com/css2?family=Outfit:wght@600&display=block");
  });
  it("falls back to an upright face and the nearest weight the family has", () => {
    expect(googleFontsHref([{ family: "Bebas Neue", faces: [{ weight: 700, italic: true }] }]))
      .toBe("https://fonts.googleapis.com/css2?family=Bebas+Neue:wght@400&display=block");
    expect(googleFontsHref([{ family: "Amiri", faces: [{ weight: 600, italic: false }] }])).toContain("family=Amiri:wght@700");
  });
  it("skips system, generic and non-catalogue families", () => {
    expect(googleFontsHref([{ family: "Arial", faces: [] }, { family: "sans-serif", faces: [] }, { family: "Pacifico (custom)", faces: [] }])).toBeNull();
  });
  it("collects the faces boards use", () => {
    const uses = fontUsesOf([board([text("Outfit", { fontWeight: "bold" }), text("Outfit", { fontStyle: "italic" }), text("Arial")])]);
    expect(uses).toEqual([
      { family: "Outfit", faces: [{ weight: 700, italic: false }, { weight: 400, italic: true }] },
      { family: "Arial", faces: [{ weight: 400, italic: false }] },
    ]);
  });
  it("keeps script-correct families for translations", () => {
    expect(getRecommendedFontForLanguage("ja")).toBe("Noto Sans JP");
    expect(getRecommendedFontForLanguage("ar")).toBe("Noto Sans Arabic");
  });
});
```

In `packages/renderer/test/boardView.test.tsx`, change the calls to `googleFontsHref([{ family: "Bricolage Grotesque", faces: [] }, { family: "Arial", faces: [] }, { family: "DM Serif Display", faces: [] }])!` and `googleFontsHref([{ family: "Arial", faces: [] }])`.

Run: `pnpm --filter @chitrapx/document exec vitest run test/fontCatalog.test.ts`
Expected: FAIL. `catalogFont` is not exported.

- [ ] **Step 2: Types and helpers**

`packages/document/src/fontCatalog.ts`:

```ts
import catalog from "./fontCatalog.json" with { type: "json" };

export type FontCategory = "sans-serif" | "serif" | "display" | "handwriting" | "monospace";
/** Picker groups; `fontLanguageMatcher.ts` relies on these to give translations a face that has the glyphs. */
export type FontScript = "latin" | "arabic" | "urdu" | "hebrew" | "cjk" | "thai" | "devanagari" | "bengali" | "multilingual";
export type FontFormat = "ttf" | "otf" | "woff" | "woff2";
/** One Google family. `scripts[0]` is the picker group; `italics` = Google serves true italics. */
export type CatalogFont = { family: string; category: FontCategory; weights: number[]; italics: boolean; scripts: FontScript[] };

/** Generated by scripts/gen-font-catalog.ts; edit the curated list there, never this JSON. */
export const FONT_CATALOG = catalog as CatalogFont[];

/** Installed on every machine; never downloaded. */
export const SYSTEM_FAMILIES: ReadonlyArray<{ family: string; category: FontCategory }> = [
  { family: "Arial", category: "sans-serif" }, { family: "Verdana", category: "sans-serif" },
  { family: "Helvetica", category: "sans-serif" }, { family: "Times New Roman", category: "serif" },
  { family: "Courier New", category: "monospace" }, { family: "Georgia", category: "serif" },
  { family: "Impact", category: "display" }, { family: "Comic Sans MS", category: "handwriting" },
];

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "math", "emoji", "fangsong", "inherit", "initial", "revert", "unset"]);
const byName = new Map(FONT_CATALOG.map((f) => [f.family.toLowerCase(), f]));
const system = new Set(SYSTEM_FAMILIES.map((f) => f.family.toLowerCase()));

export const catalogFont = (family: string): CatalogFont | undefined => byName.get(family.trim().toLowerCase());
export const isSystemOrGeneric = (family: string) => { const f = family.trim().toLowerCase(); return system.has(f) || GENERIC.has(f); };
/** A name an uploaded font may not take as-is: it would shadow a catalogue, system or generic family. */
export const isReservedFamily = (family: string) => byName.has(family.trim().toLowerCase()) || isSystemOrGeneric(family);

/** The face CSS Fonts 4 §5.2 picks for `want` among `have`, so the stylesheet requests the face the browser would use. */
export function matchWeight(have: readonly number[], want: number): number {
  if (!have.length || have.includes(want)) return want;
  const below = have.filter((w) => w < want).sort((a, b) => b - a);
  const above = have.filter((w) => w > want).sort((a, b) => a - b);
  if (want >= 400 && want <= 500) return above.find((w) => w <= 500) ?? below[0] ?? above[0]!;
  return want < 400 ? (below[0] ?? above[0]!) : (above[0] ?? below[0]!);
}

/** A stored fontWeight ("normal", "bold", "600", 700) as a number. */
export function parseWeight(w: string | number | undefined): number {
  if (typeof w === "number") return Number.isFinite(w) ? Math.min(1000, Math.max(1, Math.round(w))) : 400;
  if (w === "bold") return 700;
  const n = Number(w);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 400;
}

/** Characters a fontFamily may never contain (the document validator rejects them). */
export const FONT_FAMILY_UNSAFE = /["\\;{}<>\u0000-\u001f\u007f]/;

/**
 * A family name from an uploaded font's name table, made safe: letters, digits and a little
 * punctuation only, so it can never break out of CSS or contain url( / expression(.
 * The " (custom)" suffix is added by the caller after this.
 */
export function cleanFamilyName(raw: string): string {
  return raw.normalize("NFC").replace(/[^\p{L}\p{N} \-_.,'&+!]/gu, "").replace(/\s+/g, " ").trim().slice(0, 80).trim();
}
```

Add `export * from "./fontCatalog.ts";` to `packages/document/src/index.ts`. Add `"gen-font-catalog": "tsx scripts/gen-font-catalog.ts"` to `packages/document/package.json` scripts.

- [ ] **Step 3: The generator**

`packages/document/scripts/gen-font-catalog.ts`:

```ts
// Writes src/fontCatalog.json: the curated families below, with weights, italics and scripts read from the
// Google Fonts metadata Next.js ships (next/dist/compiled/@next/font/dist/google/font-data.json). No API key.
// Run: pnpm --filter @chitrapx/document gen-font-catalog
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { CatalogFont, FontCategory, FontScript } from "../src/fontCatalog.ts";

export type GoogleMeta = Record<string, { weights: string[]; styles: string[]; subsets: string[] }>;

export const CURATED: Record<FontCategory, string[]> = {
  "sans-serif": ["Inter", "Inter Tight", "Roboto", "Roboto Flex", "Open Sans", "Lato", "Montserrat", "Poppins", "Raleway", "Nunito", "Nunito Sans", "Work Sans", "DM Sans", "Manrope", "Plus Jakarta Sans", "Sora", "Figtree", "Outfit", "Lexend", "Jost", "Urbanist", "Rubik", "Quicksand", "Cabin", "Karla", "Mulish", "Albert Sans", "Bricolage Grotesque", "Geist", "Onest", "Instrument Sans", "Be Vietnam Pro", "Space Grotesk", "IBM Plex Sans", "Source Sans 3", "Hind", "Barlow", "Barlow Condensed", "Barlow Semi Condensed", "Archivo", "Archivo Narrow", "Fira Sans", "Fira Sans Condensed", "Merriweather Sans", "PT Sans", "Ubuntu", "Oxygen", "Heebo", "Assistant", "Kanit", "Prompt", "Titillium Web", "Exo 2", "Red Hat Display", "Red Hat Text", "Public Sans", "Schibsted Grotesk", "Hanken Grotesk", "Familjen Grotesk", "Golos Text", "Wix Madefor Display", "Epilogue", "Syne", "Chivo", "Overpass", "Asap", "Signika", "Encode Sans", "Libre Franklin", "Mukta", "Varela Round", "M PLUS Rounded 1c", "Zen Kaku Gothic New", "Saira", "Saira Condensed", "Oswald", "Teko", "Big Shoulders", "Anek Latin", "Readex Pro", "Atkinson Hyperlegible"],
  serif: ["Playfair Display", "Lora", "Merriweather", "EB Garamond", "Cormorant Garamond", "Cormorant", "Libre Baskerville", "Source Serif 4", "Crimson Text", "Crimson Pro", "DM Serif Display", "DM Serif Text", "Fraunces", "Instrument Serif", "Newsreader", "Literata", "Spectral", "Bitter", "Zilla Slab", "Roboto Slab", "Arvo", "Noto Serif", "PT Serif", "Old Standard TT", "Cardo", "Bodoni Moda", "Libre Caslon Text", "Prata", "Gloock", "Young Serif", "Adamina", "Alegreya", "Domine", "Frank Ruhl Libre", "Lusitana", "Shippori Mincho", "Zen Old Mincho", "Noto Serif Display", "Rozha One", "Abril Fatface", "Alfa Slab One", "Yeseva One", "Marcellus", "Cinzel"],
  display: ["Bebas Neue", "Anton", "Archivo Black", "Bungee", "Ranchers", "Calistoga", "Baloo 2", "Fredoka", "Unbounded", "Righteous", "Titan One", "Luckiest Guy", "Bangers", "Monoton", "Lobster", "Fjalla One", "Russo One", "Lilita One", "Boogaloo", "Black Han Sans", "Bowlby One", "Rubik Mono One", "Dela Gothic One", "Chango", "Shrikhand", "Bagel Fat One", "Rammetto One", "Paytone One", "Passion One", "Staatliches", "Bungee Shade", "Rubik Glitch", "Climate Crisis", "Syne Mono", "Krona One", "Michroma", "Orbitron", "Audiowide", "Press Start 2P", "Silkscreen", "Cherry Bomb One", "Chewy", "Sniglet", "Gochi Hand"],
  handwriting: ["Pacifico", "Caveat", "Caveat Brush", "Dancing Script", "Great Vibes", "Permanent Marker", "Satisfy", "Sacramento", "Kaushan Script", "Parisienne", "Yellowtail", "Shadows Into Light", "Indie Flower", "Amatic SC", "Patrick Hand", "Homemade Apple", "Reenie Beanie", "Rock Salt", "Nothing You Could Do", "Mrs Saint Delafield", "Allura", "Cookie", "Courgette", "Kalam", "Architects Daughter", "Gloria Hallelujah", "Covered By Your Grace", "Just Another Hand", "Yuji Syuku"],
  monospace: ["JetBrains Mono", "Fira Code", "Source Code Pro", "Space Mono", "Geist Mono", "IBM Plex Mono", "Roboto Mono", "DM Mono", "Inconsolata", "Ubuntu Mono", "Courier Prime", "Martian Mono"],
};

/** Families whose picker group is not Latin. Keep in step with osg/lib/fontLanguageMatcher.ts. */
export const SCRIPT_FAMILIES: Array<[string, FontCategory, FontScript]> = [
  ["Noto Sans", "sans-serif", "multilingual"],
  ["Noto Sans Arabic", "sans-serif", "arabic"], ["IBM Plex Sans Arabic", "sans-serif", "arabic"], ["Cairo", "sans-serif", "arabic"],
  ["Tajawal", "sans-serif", "arabic"], ["Almarai", "sans-serif", "arabic"], ["Amiri", "serif", "arabic"],
  ["Scheherazade New", "serif", "arabic"], ["Markazi Text", "serif", "arabic"], ["Lateef", "serif", "arabic"],
  ["Noto Nastaliq Urdu", "serif", "urdu"],
  ["Noto Sans Hebrew", "sans-serif", "hebrew"], ["Noto Sans Thai", "sans-serif", "thai"],
  ["Noto Sans Devanagari", "sans-serif", "devanagari"], ["Noto Sans Bengali", "sans-serif", "bengali"],
  ["Noto Sans JP", "sans-serif", "cjk"], ["Noto Sans SC", "sans-serif", "cjk"], ["Noto Sans TC", "sans-serif", "cjk"],
  ["Noto Sans KR", "sans-serif", "cjk"], ["Noto Serif JP", "serif", "cjk"],
];

const SUBSET_SCRIPT: Record<string, FontScript> = { arabic: "arabic", hebrew: "hebrew", thai: "thai", devanagari: "devanagari", bengali: "bengali" };

export function buildCatalog(meta: GoogleMeta): CatalogFont[] {
  const entries: Array<[string, FontCategory, FontScript | null]> = [
    ...(Object.entries(CURATED) as Array<[FontCategory, string[]]>).flatMap(([category, families]) => families.map((f) => [f, category, null] as [string, FontCategory, null])),
    ...SCRIPT_FAMILIES,
  ];
  const seen = new Set<string>();
  return entries.map(([family, category, script]): CatalogFont => {
    if (seen.has(family)) throw new Error(`listed twice: ${family}`);
    seen.add(family);
    const m = meta[family];
    if (!m) throw new Error(`not a Google Fonts family (check the spelling): ${family}`);
    const weights = m.weights.filter((w) => /^\d+$/.test(w)).map(Number).sort((a, b) => a - b);
    const derived = [...new Set<FontScript>([...(m.subsets.includes("latin") ? ["latin" as const] : []), ...m.subsets.flatMap((s) => (SUBSET_SCRIPT[s] ? [SUBSET_SCRIPT[s]!] : []))])];
    const scripts: FontScript[] = script ? [script, ...derived.filter((s) => s !== script)] : derived.length ? derived : ["latin"];
    return { family, category, weights: weights.length ? weights : [400], italics: m.styles.includes("italic"), scripts };
  }).sort((a, b) => a.family.localeCompare(b.family));
}

if (import.meta.main) {
  const require = createRequire(join(import.meta.dirname, "../../../apps/web/package.json"));
  const meta = require("next/dist/compiled/@next/font/dist/google/font-data.json") as GoogleMeta;
  const catalog = buildCatalog(meta);
  writeFileSync(join(import.meta.dirname, "../src/fontCatalog.json"), `${JSON.stringify(catalog, null, 1)}\n`);
  console.log(`${catalog.length} families written`);
}
```

Run: `pnpm --filter @chitrapx/document gen-font-catalog`
Expected: `230 families written`. `packages/document/src/fontCatalog.json` exists.

Run: `pnpm --filter @chitrapx/document exec vitest run test/fontCatalog.test.ts`
Expected: PASS.

- [ ] **Step 4: `fontService.ts` reads the catalogue**

In `packages/renderer/src/osg/lib/fontService.ts`:
- Replace the `FontScript` declaration with `export type { FontScript } from '@chitrapx/document';`.
- Import `FONT_CATALOG`, `SYSTEM_FAMILIES` and `type FontScript` from `@chitrapx/document`.
- Replace the whole `GOOGLE_FONTS` array and `SYSTEM_FONTS` array with:

```ts
const FALLBACK: Record<string, string> = { serif: 'serif', monospace: 'monospace', handwriting: 'cursive', display: 'sans-serif', 'sans-serif': 'sans-serif' };

// The Google families the picker offers: the generated catalogue (packages/document/src/fontCatalog.json).
export const GOOGLE_FONTS: AppFont[] = FONT_CATALOG.map((f) => ({
  family: f.family, variants: f.weights.map(String), category: f.category, fallback: FALLBACK[f.category], script: f.scripts[0],
}));

// Default system fonts to include along with Google fonts
export const SYSTEM_FONTS: AppFont[] = SYSTEM_FAMILIES.map((f) => ({ family: f.family, category: f.category, script: 'latin' as const }));
```

Delete `createGoogleFontsUrl`, `GOOGLE_FONT_STYLE_ID` and `preloadGoogleFonts`. Nothing calls them, and they fetch every family eagerly. Add `ensureFont` after `ALL_FONTS`:

```ts
import { googleFontsHref } from '../../fonts.tsx';

const requested = new Set<string>();
/**
 * Loads one face on demand (font picker previews, a family just picked) and resolves once the
 * browser has it. One small css2 link per face; nothing is fetched until something asks.
 */
export async function ensureFont(family: string, weight = 400, italic = false): Promise<void> {
  if (typeof document === 'undefined') return;
  const href = googleFontsHref([{ family, faces: [{ weight, italic }] }]);
  if (href && !requested.has(href)) {
    requested.add(href);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    const loaded = new Promise<void>((resolve) => { link.onload = () => resolve(); link.onerror = () => resolve(); });
    document.head.appendChild(link);
    await loaded;
  }
  await document.fonts.load(`${italic ? 'italic ' : ''}${weight} 32px ${cssFontFamily(family)}`).catch(() => []);
}
```

- [ ] **Step 5: `fonts.tsx` with faces and the italic axis**

Replace `packages/renderer/src/fonts.tsx`:

```tsx
import { catalogFont, matchWeight, parseWeight, type ArtboardState, type TextElementProps } from "@chitrapx/document";

export type FontFace = { weight: number; italic: boolean };
export type FontUse = { family: string; faces: FontFace[] };

/** Families and faces used by text on these boards (per-locale overrides already projected in). */
export function fontUsesOf(boards: ArtboardState[]): FontUse[] {
  const uses = new Map<string, Map<string, FontFace>>();
  const add = (family: string, weight: number, italic: boolean) => {
    const faces = uses.get(family) ?? new Map<string, FontFace>();
    faces.set(`${weight}:${italic}`, { weight, italic });
    uses.set(family, faces);
  };
  for (const b of boards) for (const el of b.elements) {
    if (el.type !== "text") continue;
    const t = el as TextElementProps;
    const family = t.fontFamily?.trim();
    if (!family) continue;
    add(family, parseWeight(t.fontWeight), t.fontStyle === "italic");
  }
  return [...uses].map(([family, faces]) => ({ family, faces: [...faces.values()] }));
}

export const fontFamiliesOf = (boards: ArtboardState[]): string[] => fontUsesOf(boards).map((u) => u.family);

/**
 * One css2 URL for the catalogue families in use: the weights the browser would pick (no
 * synthetic weights), the italic axis only where a family is used in italic and has one.
 * Anything not in the catalogue (system, generic, uploaded) is never sent to Google.
 */
export function googleFontsHref(uses: FontUse[]): string | null {
  const params = uses.flatMap((u) => {
    const font = catalogFont(u.family);
    if (!font) return [];
    const tuples = new Map<string, [number, number]>();
    for (const f of u.faces.length ? u.faces : [{ weight: 400, italic: false }]) {
      const ital = f.italic && font.italics ? 1 : 0;
      const w = matchWeight(font.weights, f.weight);
      tuples.set(`${ital},${w}`, [ital, w]);
    }
    const sorted = [...tuples.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const name = font.family.replace(/ /g, "+");
    return [sorted.some(([i]) => i)
      ? `family=${name}:ital,wght@${sorted.map(([i, w]) => `${i},${w}`).join(";")}`
      : `family=${name}:wght@${sorted.map(([, w]) => w).join(";")}`];
  }).sort();
  return params.length ? `https://fonts.googleapis.com/css2?${params.join("&")}&display=block` : null;
}

/** React 19 hoists this stylesheet into <head>; display=block keeps exports from capturing fallback glyphs. */
export function BoardFonts({ boards }: { boards: ArtboardState[] }) {
  const href = googleFontsHref(fontUsesOf(boards));
  return href ? <link rel="stylesheet" href={href} precedence="chitrapx-fonts" /> : null;
}
```

In `packages/renderer/src/index.ts`:
- Change the fonts line to `export { BoardFonts, fontFamiliesOf, fontUsesOf, googleFontsHref, type FontFace, type FontUse } from "./fonts.tsx";`.
- Change the fontService line to `export { ALL_FONTS, cssFontFamily, ensureFont } from "./osg/lib/fontService";`.

- [ ] **Step 6: Run the renderer and document tests**

Run: `pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/renderer test`
Expected: PASS.

- [ ] **Step 7: No Google request on editor load**

Run: `grep -rn "fonts.googleapis.com" apps/web/src packages/renderer/src --include=*.ts --include=*.tsx`
Expected: only `packages/renderer/src/fonts.tsx`.

- [ ] **Step 8: Goldens**

```bash
pnpm storage:up && pnpm storage:setup
cd apps/web && (nohup ./node_modules/.bin/next dev > /tmp/chitrapx-web.log 2>&1 & echo $! > /tmp/chitrapx-web.pid); cd ../..
for i in $(seq 1 60); do curl -sf http://localhost:3000/api/health > /dev/null && break; sleep 2; done
pnpm --filter @chitrapx/worker test:e2e
```

Expected:
- `fg-chat-connect` and `mac-boardly` pass.
- `amoura-dating`, `single-amoura-02.png` and `status-bar-ios.png` may fail on pixel count. If any fail:
  - Run `UPDATE_GOLDEN=1 pnpm --filter @chitrapx/worker exec vitest run --config vitest.e2e.config.ts -t "amoura-dating|single PNG|status bar"`.
  - Open the three PNGs. The words that are italic must now show Playfair's true italic letterforms. Nothing else may have changed.
- Rerun `pnpm --filter @chitrapx/worker test:e2e`. It must pass.

Stop the server with `kill "$(cat /tmp/chitrapx-web.pid)"`.

- [ ] **Step 9: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: only `billing.ts:61`.

```bash
git add packages/document packages/renderer packages/assets/golden
git commit -m "feat(fonts): curated 230-family catalogue, on-demand loading, italic axis and CSS weight matching"
```

---

### Task 5: Font picker

**Files:**
- Create: `packages/document/src/docFonts.ts`, `packages/document/test/docFonts.test.ts`
- Create: `apps/web/src/editor/fontPickerModel.ts`, `apps/web/src/editor/ui/FontPicker.tsx`, `apps/web/test/fontPicker.test.ts`
- Modify: `packages/document/src/index.ts`, `apps/web/src/editor/ui/Inspector.tsx:6,14,117` (font field), `apps/web/src/components/BrandForm.tsx` (heading and body font fields)

**Interfaces:**
- Consumes: `FONT_CATALOG`, `SYSTEM_FAMILIES`, `catalogFont` (Task 4), `ensureFont`, `cssFontFamily` (Task 4).
- Produces:
  - `docFontFamilies(doc: unknown): string[]` from `@chitrapx/document`. It returns every `fontFamily` string anywhere in a document (elements, span elements, locale overrides), trimmed, unique and in first-seen order.
  - `type FontRow = { family: string; category: string; group: "used" | "custom" | "google" | "system" }`
  - `fontRows(opts: { query: string; category: string; used: string[]; custom: string[] }): FontRow[]`
  - `GROUP_LABELS: Record<FontRow["group"], string>`
  - `FontPicker({ id, label, value, onChange, used?, custom?, onUpload? })`. `custom` is `Array<{ family: string }>`. `onUpload` shows the "Upload font" button (Task 7 wires it).

> **Ruling (system fonts):** the spec names three groups ("Used in this project", "Your fonts", "Google Fonts"). The eight system fonts are not Google fonts, so they get a fourth group, "System".

- [ ] **Step 1: Failing tests**

`packages/document/test/docFonts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { docFontFamilies } from "../src/index.ts";
import { board, doc, group, text } from "./fixtures.ts";

describe("docFontFamilies", () => {
  it("finds families on boards, span elements and locale overrides, once each", () => {
    const b = board("b1", [text("t", 0, 0), { ...text("u", 0, 300), fontFamily: " Outfit " } as never]);
    b.localized = { "de-DE": { t: { fontFamily: "Pacifico (custom)" } } };
    const d = doc([group([b], [{ ...text("s", 0, 0), fontFamily: "Anton" } as never])]);
    expect(docFontFamilies(d).sort()).toEqual(["Anton", "Inter", "Outfit", "Pacifico (custom)"]);
  });
});
```

`apps/web/test/fontPicker.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fontRows } from "@/editor/fontPickerModel.ts";

const all = { query: "", category: "all", used: [], custom: [] };

describe("font picker rows", () => {
  it("groups used, uploaded, Google and system fonts in that order", () => {
    const rows = fontRows({ ...all, used: ["Outfit", "My Brand"], custom: ["My Brand"] });
    expect(rows.slice(0, 3)).toEqual([
      { family: "Outfit", category: "sans-serif", group: "used" },
      { family: "My Brand", category: "custom", group: "used" },
      { family: "My Brand", category: "custom", group: "custom" },
    ]);
    expect(rows.filter((r) => r.group === "google").length).toBeGreaterThanOrEqual(150);
    expect(rows.at(-1)!.group).toBe("system");
  });
  it("searches every group, case-insensitively", () => {
    const rows = fontRows({ ...all, query: "pLAY", custom: ["Playful Co"] });
    expect(rows.map((r) => r.family)).toEqual(["Playful Co", "Playfair Display"]);
  });
  it("filters Google fonts by category", () => {
    const rows = fontRows({ ...all, category: "monospace" });
    expect(rows.every((r) => r.group !== "google" || r.category === "monospace")).toBe(true);
    expect(rows.some((r) => r.family === "JetBrains Mono")).toBe(true);
  });
});
```

Run: `pnpm --filter @chitrapx/document exec vitest run test/docFonts.test.ts && pnpm --filter @chitrapx/web exec vitest run test/fontPicker.test.ts`
Expected: FAIL. The modules are missing.

- [ ] **Step 2: `docFonts.ts`**

```ts
// packages/document/src/docFonts.ts
/**
 * Every fontFamily the document names, wherever it is (elements, span elements, per-locale
 * overrides), trimmed and unique. Walks plain JSON so it also works on raw stored documents.
 */
export function docFontFamilies(doc: unknown): string[] {
  const out = new Set<string>();
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (k === "fontFamily" && typeof x === "string" && x.trim()) out.add(x.trim());
      else visit(x);
    }
  };
  visit(doc);
  return [...out];
}
```

Add `export * from "./docFonts.ts";` to `packages/document/src/index.ts`.

- [ ] **Step 3: The picker model and component**

`apps/web/src/editor/fontPickerModel.ts`:

```ts
import { catalogFont, FONT_CATALOG, SYSTEM_FAMILIES } from "@chitrapx/document";

export type FontRow = { family: string; category: string; group: "used" | "custom" | "google" | "system" };
export const GROUP_LABELS: Record<FontRow["group"], string> = { used: "Used in this project", custom: "Your fonts", google: "Google Fonts", system: "System" };

/** The picker's rows: used fonts first, then uploads, the catalogue (category-filtered) and system fonts. */
export function fontRows({ query, category, used, custom }: { query: string; category: string; used: string[]; custom: string[] }): FontRow[] {
  const q = query.trim().toLowerCase();
  const hit = (family: string) => !q || family.toLowerCase().includes(q);
  const categoryOf = (family: string) => catalogFont(family)?.category ?? SYSTEM_FAMILIES.find((s) => s.family === family)?.category ?? "custom";
  return [
    ...used.filter(hit).map((family) => ({ family, category: categoryOf(family), group: "used" as const })),
    ...custom.filter(hit).map((family) => ({ family, category: "custom", group: "custom" as const })),
    ...FONT_CATALOG.filter((f) => hit(f.family) && (category === "all" || f.category === category)).map((f) => ({ family: f.family, category: f.category, group: "google" as const })),
    ...SYSTEM_FAMILIES.filter((f) => hit(f.family)).map((f) => ({ family: f.family, category: f.category, group: "system" as const })),
  ];
}
```

`apps/web/src/editor/ui/FontPicker.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { catalogFont } from "@chitrapx/document";
import { cssFontFamily, ensureFont } from "@chitrapx/renderer";
import { fontRows, GROUP_LABELS, type FontRow } from "../fontPickerModel.ts";

const CATEGORIES = [["all", "All"], ["sans-serif", "Sans serif"], ["serif", "Serif"], ["display", "Display"], ["handwriting", "Handwriting"], ["monospace", "Monospace"]] as const;

/** A row whose name is drawn in its own face once it scrolls into view (nothing loads before that). */
function PreviewRow({ row, selected, onPick }: { row: FontRow; selected: boolean; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setVisible(true); io.disconnect(); } });
    io.observe(node);
    return () => io.disconnect();
  }, []);
  useEffect(() => { if (visible && catalogFont(row.family)) void ensureFont(row.family); }, [visible, row.family]);
  return (
    <button ref={ref} type="button" role="option" aria-selected={selected} onClick={onPick}
      className={`block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${selected ? "bg-indigo-50 dark:bg-indigo-950" : ""}`}
      style={visible ? { fontFamily: cssFontFamily(row.family) } : undefined}>
      {row.family}
    </button>
  );
}

export function FontPicker({ id, label, value, onChange, used = [], custom = [], onUpload }: {
  id: string; label: string; value: string; onChange: (family: string) => void;
  used?: string[]; custom?: Array<{ family: string }>; onUpload?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const rows = useMemo(() => fontRows({ query, category, used, custom: custom.map((c) => c.family) }), [query, category, used, custom]);
  const pick = (family: string) => { onChange(family); setOpen(false); setQuery(""); };
  return (
    <div className="relative space-y-1">
      <label className="label" htmlFor={id}>{label}</label>
      <button id={id} type="button" className="input flex w-full items-center justify-between text-left" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)} style={{ fontFamily: cssFontFamily(value) }}>
        <span className="truncate">{value || "Choose a font"}</span><span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
          <input autoFocus className="input mb-2" placeholder="Search fonts" aria-label="Search fonts" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="input mb-2" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <div role="listbox" aria-label={label} className="max-h-72 overflow-y-auto">
            {(["used", "custom", "google", "system"] as const).map((g) => {
              const inGroup = rows.filter((r) => r.group === g);
              if (!inGroup.length && !(g === "custom" && onUpload)) return null;
              return (
                <div key={g} className="mb-2">
                  <div className="flex items-center justify-between px-2 text-xs font-medium text-neutral-500">
                    <span>{GROUP_LABELS[g]}</span>
                    {g === "custom" && onUpload && <button type="button" className="text-indigo-600 hover:underline" onClick={() => { setOpen(false); onUpload(); }}>Upload font</button>}
                  </div>
                  {inGroup.map((r) => <PreviewRow key={`${g}:${r.family}`} row={r} selected={r.family === value} onPick={() => pick(r.family)} />)}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Use it in the inspector and the brand form**

In `apps/web/src/editor/ui/Inspector.tsx`:
- Remove `import { ALL_FONTS } from "@chitrapx/renderer";` and the `FONT_OPTIONS` constant.
- Import `FontPicker` from `./FontPicker.tsx`, add `docFontFamilies` to the `@chitrapx/document` import, and add `useMemo` to the React import.
- In `ElementInspector`, read the doc and compute the used families once per document change:

```tsx
  const doc = useEditor((s) => s.doc);
  const used = useMemo(() => docFontFamilies(doc), [doc]);
```

Replace the font `SelectField` with:

```tsx
          <FontPicker id="i-font" label="Font" value={override?.fontFamily ?? a.fontFamily ?? ""} used={used}
            onChange={(v) => setLocalizable("fontFamily", v)} />
```

In `apps/web/src/components/BrandForm.tsx`, import `FontPicker` from `@/editor/ui/FontPicker.tsx`. Replace the two font `<input>` blocks (each `<div>` with its label) with:

```tsx
        <FontPicker id="b-hfont" label="Heading font" value={form.headingFont} onChange={set("headingFont")} />
        <FontPicker id="b-bfont" label="Body font" value={form.bodyFont} onChange={set("bodyFont")} />
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/web exec vitest run test/fontPicker.test.ts`
Expected: PASS.

- [ ] **Step 6: Browser check**

Start the web dev server in the background:

```bash
cd apps/web && (nohup ./node_modules/.bin/next dev > /tmp/chitrapx-web.log 2>&1 & echo $! > /tmp/chitrapx-web.pid); cd ../..
for i in $(seq 1 60); do curl -sf http://localhost:3000/api/health > /dev/null && break; sleep 2; done
```

Open the editor with DevTools Network filtered to `fonts.googleapis`.
- Loading the editor makes requests only for families on the boards.
- Opening the picker and scrolling loads the visible families.
- Picking "Fraunces" renders on the canvas within about 1 s.
- Reloading keeps it.

Stop the server with `kill "$(cat /tmp/chitrapx-web.pid)"`.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: only `billing.ts:61`.

```bash
git add packages/document apps/web
git commit -m "feat(editor): searchable font picker with lazy previews, in the inspector and brand form"
```

---

### Task 6: Font upload on the server (sniff, sandboxed parse, quota, API)

**Files:**
- Create: `packages/db/test/fixtures/fonts/{inter-400.woff2,inter-700.woff2,inter-400.woff,inter-400.ttf,source-sans-3.otf,pacifico.woff2}` (downloaded once, committed)
- Create: `packages/db/src/fontParse.ts`, `packages/db/test/fontFixtures.ts`, `packages/db/test/fontCheck.test.ts`
- Modify: `packages/db/src/assetCheck.ts` (whole file shown), `packages/db/src/schema.ts:23-31` (`AssetMeta`), `packages/db/src/index.ts`, `packages/db/package.json` (+ `fontkit`)
- Modify: `apps/web/package.json` (+ `fontkit`, so Next's server bundle can resolve it), `apps/web/next.config.ts` (`serverExternalPackages`)
- Modify: `apps/web/src/server/uploads.ts` (font sign and complete)
- Create: `apps/web/src/server/fonts.ts`, `apps/web/src/app/api/fonts/route.ts`, `apps/web/src/app/api/fonts/[assetId]/route.ts`
- Test: `apps/web/test/fonts.test.ts` (create)
- Modify: `NOTICES.md` (fixture fonts row)

**Interfaces:**
- Consumes: `cleanFamilyName`, `isReservedFamily`, `FontFormat` (Task 4), `docFontFamilies` (Task 5), `readStaged`, `stagingPath`, `memoryStorage` (Tasks 1 and 2).
- Produces (from `@chitrapx/db`):
  - `AssetKind = "screenshot" | "image" | "recording" | "font"`, `ACCEPTED.font`, `HEAD_BYTES.font = UPLOAD_LIMITS.font`
  - `sniffFontType(head: Uint8Array): { mime: string; format: FontFormat } | null`
  - `type FontMeta = { family: string; weight: number; italic: boolean; format: FontFormat }`. `AssetMeta` gains these as optional fields, and `ready` becomes optional.
  - `type ParsedFont = { family: string; weight: number; italic: boolean; format: FontFormat; embeddable: boolean }`
  - `parseFont(bytes, format, opts?: { timeoutMs?: number }): Promise<ParsedFont>`. It throws `FontRejected("font_unreadable")`.
  - `checkFont(bytes, format): Promise<ParsedFont>`. It throws `FontRejected("font_restricted" | "font_unreadable")`.
  - `class FontRejected extends Error { code: "font_restricted" | "font_unreadable" }`
  - `fontFamilyFor(parsedFamily: string): string`. It adds ` (custom)` when the family is reserved.
- Produces (web):
  - `signUpload` accepts `{ kind: "font", size, sha256, embedRights: true, mime? }` with no `appId`. `completeUpload` accepts `{ kind: "font", sha256, uploadId }`.
  - From `@/server/fonts.ts`:
    - `FONT_QUOTA = { faces: 20, bytes: 50 * 1024 * 1024 }`
    - `type FontFaceRow = { assetId: string; weight: number; italic: boolean; format: FontFormat; url: string }`
    - `type FontFamilyRow = { family: string; faces: FontFaceRow[] }`
    - `listFonts(ctx, storage): Promise<FontFamilyRow[]>`
    - `deleteFont(ctx, storage, assetId): Promise<void>`. It returns 409 `font_in_use` with `{ projects: [{ id, name }] }` when the face is the last of a used family.
    - `assertFontQuota(tx, ctx, addingBytes)`, `fontUsage(tx, workspaceId)`, `findWorkspaceFont(ctx, sha256)`
  - Routes: `GET /api/fonts` and `DELETE /api/fonts/:assetId`

> **Ruling (duplicate face):** a different file with the same family, weight and style as an existing face is rejected 409 `font_face_exists`. Without this, two `@font-face` rules would compete and which one renders would depend on rule order. This error code is not in the spec.
>
> **Ruling (`AssetMeta`):** `ready` becomes optional so font rows can carry `{ family, weight, italic, format }`. Every existing read is `meta?.ready`, and recordings still always write it.
>
> **Ruling (types):** fontkit is loaded only inside the worker thread, by file path. No module imports it, so no type package or `.d.ts` is needed.

- [ ] **Step 1: Download the fixture fonts (one time)**

These are OFL fonts: Inter, Pacifico and Source Sans 3. The `text=` parameter keeps the Google files to a few KB.

```bash
mkdir -p packages/db/test/fixtures/fonts && cd packages/db/test/fixtures/fonts
CHROME='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
IE11='Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko'
TEXT='Hello%20Chitrapx%20ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.%2C!'
ff() { u=$(curl -s -A "$2" "https://fonts.googleapis.com/css2?family=$1&text=$TEXT" | grep -o 'url([^)]*)' | head -1 | sed 's/^url(//;s/)$//'); curl -s -o "$3" "$u"; }
ff 'Inter:wght@400' "$CHROME" inter-400.woff2
ff 'Inter:wght@700' "$CHROME" inter-700.woff2
ff 'Inter:wght@400' "$IE11" inter-400.woff
ff 'Inter:wght@400' "" inter-400.ttf
ff 'Pacifico' "$CHROME" pacifico.woff2
curl -sL -o source-sans-3.otf https://github.com/adobe-fonts/source-sans/raw/release/OTF/SourceSans3-Regular.otf
for f in *; do printf '%s %s\n' "$(head -c4 "$f" | xxd -p)" "$f"; done
cd -
```

Expected magic bytes:

```
774f4632 inter-400.woff2
774f4632 inter-700.woff2
774f4646 inter-400.woff
00010000 inter-400.ttf
774f4632 pacifico.woff2
4f54544f source-sans-3.otf
```

Add a row to the `NOTICES.md` table:

```markdown
| Test fixture fonts (SIL Open Font License 1.1) | Inter © The Inter Project Authors; Pacifico © Vernon Adams; Source Sans 3 © Adobe | Small subsets used only by tests (`packages/db/test/fixtures/fonts/`), never shipped to users. |
```

- [ ] **Step 2: Failing sniff and parse tests**

`packages/db/test/fontFixtures.ts` is a shared helper with no tests in it, so other packages can import it without running these tests:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const FONT_FIXTURES = join(import.meta.dirname, "fixtures/fonts");
export const fixtureFont = (name: string) => readFileSync(join(FONT_FIXTURES, name));

/** A copy of a TrueType font with OS/2 fsType set to `value` (bit 1 = restricted licence embedding). */
export function withFsType(ttf: Buffer, value: number): Buffer {
  const b = Buffer.from(ttf);
  const tables = b.readUInt16BE(4);
  for (let i = 0; i < tables; i++) {
    const rec = 12 + i * 16;
    if (b.toString("latin1", rec, rec + 4) === "OS/2") { b.writeUInt16BE(value, b.readUInt32BE(rec + 8) + 8); return b; }
  }
  throw new Error("no OS/2 table");
}
```

`packages/db/test/fontCheck.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkFont, fontFamilyFor, FontRejected, parseFont, sniffAsset, sniffFontType } from "../src/index.ts";
import { fixtureFont as font, withFsType } from "./fontFixtures.ts";

describe("sniffFontType", () => {
  it("recognises each format by its magic bytes", () => {
    expect(sniffFontType(font("inter-400.ttf"))).toEqual({ mime: "font/ttf", format: "ttf" });
    expect(sniffFontType(Buffer.from("true\0\0\0\0"))).toEqual({ mime: "font/ttf", format: "ttf" });
    expect(sniffFontType(font("source-sans-3.otf"))).toEqual({ mime: "font/otf", format: "otf" });
    expect(sniffFontType(font("inter-400.woff"))).toEqual({ mime: "font/woff", format: "woff" });
    expect(sniffFontType(font("inter-400.woff2"))).toEqual({ mime: "font/woff2", format: "woff2" });
  });
  it("rejects a renamed .exe, an SVG and empty or short input", () => {
    expect(sniffFontType(Buffer.from("MZ\x90\0\x03\0\0\0"))).toBeNull();
    expect(sniffFontType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffFontType(Buffer.alloc(0))).toBeNull();
    expect(sniffFontType(Buffer.from("wO"))).toBeNull();
  });
  it("sniffAsset uses it for the font kind", async () => {
    expect(await sniffAsset("font", font("inter-400.woff2"))).toEqual({ ok: true, mime: "font/woff2" });
    expect(await sniffAsset("font", Buffer.from("MZ\x90\0"))).toEqual({ ok: false, code: "unsupported_type" });
  });
});

describe("parseFont (fontkit in a worker thread)", () => {
  it("reads family, weight and style from the name and OS/2 tables", async () => {
    expect(await parseFont(font("inter-400.woff2"), "woff2")).toEqual({ family: "Inter", weight: 400, italic: false, format: "woff2", embeddable: true });
    expect(await parseFont(font("inter-700.woff2"), "woff2")).toMatchObject({ family: "Inter", weight: 700 });
    expect(await parseFont(font("inter-400.woff"), "woff")).toMatchObject({ family: "Inter", weight: 400 });
    expect(await parseFont(font("source-sans-3.otf"), "otf")).toMatchObject({ family: "Source Sans 3", weight: 400, italic: false });
  });
  it("marks a restricted-licence font as not embeddable, and checkFont rejects it", async () => {
    const restricted = withFsType(font("inter-400.ttf"), 0x0002);
    expect(await parseFont(restricted, "ttf")).toMatchObject({ embeddable: false });
    await expect(checkFont(restricted, "ttf")).rejects.toMatchObject({ code: "font_restricted" });
    expect(await checkFont(withFsType(font("inter-400.ttf"), 0x0008), "ttf")).toMatchObject({ embeddable: true }); // editable embedding is fine
  });
  it("rejects garbage behind valid magic bytes and runaway parses", async () => {
    await expect(parseFont(Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(100, 7)]), "woff2")).rejects.toBeInstanceOf(FontRejected);
    await expect(parseFont(font("inter-400.woff2"), "woff2", { timeoutMs: 1 })).rejects.toMatchObject({ code: "font_unreadable" });
  });
  it("suffixes families that would shadow a catalogue or system font", () => {
    expect(fontFamilyFor("Inter")).toBe("Inter (custom)");
    expect(fontFamilyFor("Arial")).toBe("Arial (custom)");
    expect(fontFamilyFor("Acme Brand Sans")).toBe("Acme Brand Sans");
  });
});
```

Run: `pnpm --filter @chitrapx/db exec vitest run test/fontCheck.test.ts`
Expected: FAIL. `sniffFontType` is not exported.

- [ ] **Step 3: `assetCheck.ts`, `AssetMeta` and the sandboxed parser**

Install fontkit for `packages/db`, where it is used, and for `apps/web`. Next's server bundle resolves it from the app:

Run: `pnpm --filter @chitrapx/db add fontkit && pnpm --filter @chitrapx/web add fontkit`

Replace `packages/db/src/assetCheck.ts`:

```ts
import { fileTypeFromBuffer } from "file-type";
import { imageSize } from "image-size";
import type { FontFormat } from "@chitrapx/document";

export type AssetKind = "screenshot" | "image" | "recording" | "font";

const MB = 1024 * 1024;
export const UPLOAD_LIMITS = { screenshot: 25 * MB, image: 25 * MB, recording: 500 * MB, font: 10 * MB } as const;
// ponytail: SVG stays out until it is sanitized.
export const ACCEPTED: Record<AssetKind, readonly string[]> = {
  screenshot: ["image/png", "image/jpeg", "image/webp"],
  image: ["image/png", "image/jpeg", "image/webp"],
  recording: ["video/mp4", "video/quicktime", "video/x-m4v"],
  font: ["font/ttf", "font/otf", "font/woff", "font/woff2"],
};
/** Bytes kept for type sniffing and image dimensions (JPEG headers can sit after a large EXIF block). Fonts are parsed whole. */
export const HEAD_BYTES: Record<AssetKind, number> = { screenshot: 512 * 1024, image: 512 * 1024, recording: 64 * 1024, font: UPLOAD_LIMITS.font };

/** A font's real format from its first four bytes; the client's MIME type and file name are never used. */
export function sniffFontType(head: Uint8Array): { mime: string; format: FontFormat } | null {
  if (head.length < 4) return null;
  const tag = String.fromCharCode(head[0]!, head[1]!, head[2]!, head[3]!);
  if (tag === "\0\x01\0\0" || tag === "true") return { mime: "font/ttf", format: "ttf" };
  if (tag === "OTTO") return { mime: "font/otf", format: "otf" };
  if (tag === "wOFF") return { mime: "font/woff", format: "woff" };
  if (tag === "wOF2") return { mime: "font/woff2", format: "woff2" };
  return null;
}

/** The real type of uploaded bytes (never the client's claim) and, for images, their size. */
export async function sniffAsset(kind: AssetKind, head: Uint8Array):
  Promise<{ ok: true; mime: string; width?: number; height?: number } | { ok: false; code: "unsupported_type" | "unreadable_image" }> {
  if (kind === "font") {
    const f = sniffFontType(head);
    return f ? { ok: true, mime: f.mime } : { ok: false, code: "unsupported_type" };
  }
  const type = await fileTypeFromBuffer(head);
  if (!type || !ACCEPTED[kind].includes(type.mime)) return { ok: false, code: "unsupported_type" };
  if (kind === "recording") return { ok: true, mime: type.mime };
  try {
    const { width, height } = imageSize(head);
    return { ok: true, mime: type.mime, width, height };
  } catch {
    return { ok: false, code: "unreadable_image" };
  }
}
```

In `packages/db/src/schema.ts`, replace `AssetMeta`:

```ts
/** An uploaded font face (assets.kind = 'font', appId null: owned by the workspace). */
export type FontMeta = { family: string; weight: number; italic: boolean; format: "ttf" | "otf" | "woff" | "woff2" };

/**
 * Recordings: { ready, webm, poster, duration, width, height } once processed, or { ready: false, error }.
 * Fonts: FontMeta.
 */
export type AssetMeta = {
  ready?: boolean;
  webm?: string;
  poster?: string;
  duration?: number;
  width?: number;
  height?: number;
  error?: string;
} & Partial<FontMeta>;
```

`packages/db/src/fontParse.ts`:

```ts
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { cleanFamilyName, isReservedFamily, type FontFormat } from "@chitrapx/document";

export type ParsedFont = { family: string; weight: number; italic: boolean; format: FontFormat; embeddable: boolean };
export class FontRejected extends Error {
  constructor(public code: "font_restricted" | "font_unreadable") { super(code); this.name = "FontRejected"; }
}

/** fontkit is only ever loaded inside the worker thread, by path (works unbundled and in Next's server bundle). */
function fontkitPath(): string {
  for (const base of [import.meta.url, pathToFileURL(join(process.cwd(), "package.json")).href]) {
    try { return createRequire(base).resolve("fontkit"); } catch { /* try the next base */ }
  }
  throw new Error("fontkit is not installed");
}

// Runs in its own thread with a 256 MB heap: a hostile font can crash or hang only that thread.
// Only the family/subfamily names and OS/2 weight, style and embedding bits leave it.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
try {
  const fontkit = require(workerData.fontkit);
  let font = fontkit.create(Buffer.from(workerData.bytes));
  if (Array.isArray(font.fonts)) font = font.fonts[0];
  const os2 = font["OS/2"] || {};
  const name = (k) => { try { return font.getName(k) || ""; } catch { return ""; } };
  const fs = os2.fsType;
  parentPort.postMessage({ ok: true,
    family: name("preferredFamily") || font.familyName || "",
    subfamily: name("preferredSubfamily") || font.subfamilyName || "",
    weight: os2.usWeightClass || 400,
    italicFlag: !!(os2.fsSelection && os2.fsSelection.italic),
    restricted: typeof fs === "number" ? (fs & 2) !== 0 : !!(fs && fs.noEmbedding),
  });
} catch { parentPort.postMessage({ ok: false }); }
`;

type Raw = { ok: false } | { ok: true; family: string; subfamily: string; weight: number; italicFlag: boolean; restricted: boolean };

/** Family, weight and style of an uploaded font. Throws FontRejected("font_unreadable") on any failure or after `timeoutMs`. */
export async function parseFont(bytes: Uint8Array, format: FontFormat, opts: { timeoutMs?: number } = {}): Promise<ParsedFont> {
  const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { fontkit: fontkitPath(), bytes }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
  try {
    const raw = await new Promise<Raw>((resolve, reject) => {
      const fail = () => reject(new FontRejected("font_unreadable"));
      const timer = setTimeout(fail, opts.timeoutMs ?? 5000);
      worker.once("message", (m: Raw) => { clearTimeout(timer); resolve(m); });
      worker.once("error", () => { clearTimeout(timer); fail(); });
      worker.once("exit", () => { clearTimeout(timer); fail(); });
    });
    if (!raw.ok) throw new FontRejected("font_unreadable");
    const family = cleanFamilyName(raw.family);
    if (!family) throw new FontRejected("font_unreadable");
    const weight = Math.min(1000, Math.max(1, Math.round(Number(raw.weight) || 400)));
    return { family, weight, italic: raw.italicFlag || /italic|oblique/i.test(raw.subfamily), format, embeddable: !raw.restricted };
  } finally {
    await worker.terminate();
  }
}

/** parseFont plus the licence rule: OS/2 fsType bit 1 (restricted licence embedding) is refused. */
export async function checkFont(bytes: Uint8Array, format: FontFormat): Promise<ParsedFont> {
  const parsed = await parseFont(bytes, format);
  if (!parsed.embeddable) throw new FontRejected("font_restricted");
  return parsed;
}

/** The family an upload is listed under: a name that would shadow a built-in or catalogue font gets " (custom)". */
export const fontFamilyFor = (family: string) => (isReservedFamily(family) ? `${family} (custom)` : family);
```

Add `export * from "./fontParse.ts";` to `packages/db/src/index.ts`.

Run: `pnpm --filter @chitrapx/db exec vitest run test/fontCheck.test.ts test/assetCheck.test.ts`
Expected: PASS.

- [ ] **Step 4: Failing web tests for upload, list, quota and delete**

`apps/web/test/fonts.test.ts`:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db, schema } from "@chitrapx/db";
import { memoryStorage } from "@chitrapx/storage";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { fixtureFont as font, withFsType } from "../../../packages/db/test/fontFixtures.ts";
import { createApp } from "@/server/apps.ts";
import type { Ctx } from "@/server/context.ts";
import { deleteFont, listFonts } from "@/server/fonts.ts";
import { completeUpload, signUpload, stagingPath } from "@/server/uploads.ts";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const status = (p: Promise<unknown>) => p.then(() => 200, (e: { status?: number }) => e.status ?? 500);
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");

async function setup() {
  const user = await createUser();
  const ctx: Ctx = { userId: user.id, workspaceId: await makeWorkspace(user.id, "pro"), plan: "pro" };
  return { ctx, storage: memoryStorage() };
}
type S = Awaited<ReturnType<typeof setup>>;

/** Browser side: sign (with the rights checkbox), PUT the bytes, complete. */
async function uploadFont(s: S, bytes: Buffer, extra: Record<string, unknown> = {}) {
  const signed = await signUpload(s.ctx, s.storage, { kind: "font", size: bytes.length, mime: "application/x-font-ttf", sha256: sha(bytes), embedRights: true, ...extra });
  if ("existing" in signed) return signed.existing;
  await s.storage.put(stagingPath(s.ctx, signed.uploadId), bytes, "application/octet-stream");
  return completeUpload(s.ctx, s.storage, { kind: "font", sha256: sha(bytes), uploadId: signed.uploadId });
}
const projectUsing = async (s: S, appName: string, family: string) => {
  const app = await createApp(s.ctx, { name: appName });
  const doc = { schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [] }, groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards: [{ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1,
    elements: [{ id: "t", type: "text", content: "Hi", fontSize: 40, color: "#000", fontFamily: family, position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, rotation: 0, scale: 1 }] }] }] };
  const [p] = await db.insert(schema.projects).values({ workspaceId: s.ctx.workspaceId, appId: app.id, name: `Uses ${family}`, kind: "screenshots", doc }).returning();
  return p!;
};

describe("font uploads", () => {
  it("stores a workspace font (no app), typed by its bytes, under a non-clashing family", async () => {
    const s = await setup();
    const bytes = font("inter-400.woff2");
    const asset = await uploadFont(s, bytes);
    expect(asset).toMatchObject({ appId: null, kind: "font", mime: "font/woff2", bytes: bytes.length, meta: { family: "Inter (custom)", weight: 400, italic: false, format: "woff2" } });
    expect(s.storage.types.get(`uploads/${s.ctx.workspaceId}/${sha(bytes)}`)).toBe("font/woff2");
  });

  it("needs the embedding-rights confirmation and a size within 10 MB", async () => {
    const s = await setup();
    const bytes = font("inter-400.woff2");
    expect(await code(signUpload(s.ctx, s.storage, { kind: "font", size: bytes.length, sha256: sha(bytes) }))).toBe("embed_rights_required");
    expect(await status(signUpload(s.ctx, s.storage, { kind: "font", size: 11 * 1024 * 1024, sha256: sha(bytes), embedRights: true }))).toBe(413);
  });

  it("rejects a renamed .exe or SVG, a restricted licence and unreadable bytes, keeping nothing", async () => {
    const s = await setup();
    expect(await code(uploadFont(s, Buffer.from("MZ\x90\0\x03\0\0\0 not a font")))).toBe("unsupported_type");
    expect(await code(uploadFont(s, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")))).toBe("unsupported_type");
    expect(await code(uploadFont(s, withFsType(font("inter-400.ttf"), 2)))).toBe("font_restricted");
    expect(await code(uploadFont(s, Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(64, 1)])))).toBe("font_unreadable");
    expect(s.storage.files.size).toBe(0);
    expect(await listFonts(s.ctx, s.storage)).toEqual([]);
  });

  it("returns the existing face for the same file; refuses a second file for the same face", async () => {
    const s = await setup();
    const first = await uploadFont(s, font("inter-400.woff2"));
    expect((await uploadFont(s, font("inter-400.woff2"))).id).toBe(first.id);
    expect(await code(uploadFont(s, font("inter-400.ttf")))).toBe("font_face_exists"); // same family, 400, upright
  });

  it("groups faces into families and lists them with signed URLs", async () => {
    const s = await setup();
    await uploadFont(s, font("inter-700.woff2"));
    await uploadFont(s, font("inter-400.woff2"));
    await uploadFont(s, font("pacifico.woff2"));
    const fonts = await listFonts(s.ctx, s.storage);
    expect(fonts.map((f) => [f.family, f.faces.map((x) => x.weight)])).toEqual([["Inter (custom)", [400, 700]], ["Pacifico (custom)", [400]]]);
    expect(fonts[0]!.faces[0]!.url).toMatch(/^memory:\/\/uploads\//);
  });

  it("enforces 20 faces or 50 MB per workspace at sign time, with counts in the message", async () => {
    const s = await setup();
    await db.insert(schema.assets).values(Array.from({ length: 20 }, (_, i) => ({ workspaceId: s.ctx.workspaceId, appId: null, kind: "font" as const,
      storagePath: `x/${i}`, mime: "font/woff2", bytes: 1000, sha256: String(i).padStart(64, "0"), meta: { family: `F${i}`, weight: 400, italic: false, format: "woff2" as const } })));
    const bytes = font("pacifico.woff2");
    await expect(signUpload(s.ctx, s.storage, { kind: "font", size: bytes.length, sha256: sha(bytes), embedRights: true }))
      .rejects.toMatchObject({ status: 403, code: "font_quota", message: expect.stringContaining("20 of 20 fonts") });
  });

  it("blocks deleting the last face of a family a project uses, in any app of the workspace", async () => {
    const s = await setup();
    const face = await uploadFont(s, font("pacifico.woff2"));
    const p = await projectUsing(s, "Other app", "Pacifico (custom)");
    await expect(deleteFont(s.ctx, s.storage, face.id)).rejects.toMatchObject({ status: 409, code: "font_in_use", details: { projects: [{ id: p.id, name: p.name }] } });
    expect(s.storage.files.size).toBe(1);
  });

  it("deletes one face of a family that keeps another, and an unused face with its object", async () => {
    const s = await setup();
    const regular = await uploadFont(s, font("inter-400.woff2"));
    const bold = await uploadFont(s, font("inter-700.woff2"));
    await projectUsing(s, "App", "Inter (custom)");
    await deleteFont(s.ctx, s.storage, bold.id);
    expect((await listFonts(s.ctx, s.storage))[0]!.faces.map((f) => f.assetId)).toEqual([regular.id]);
    const lone = await uploadFont(s, font("pacifico.woff2"));
    await deleteFont(s.ctx, s.storage, lone.id);
    expect(await s.storage.exists(`${s.ctx.workspaceId}/${sha(font("pacifico.woff2"))}`)).toBe(false);
  });

  it("another workspace cannot see or delete my fonts", async () => {
    const mine = await setup();
    const face = await uploadFont(mine, font("pacifico.woff2"));
    const other = await setup();
    expect(await listFonts(other.ctx, other.storage)).toEqual([]);
    expect(await status(deleteFont(other.ctx, other.storage, face.id))).toBe(404);
  });
});
```

Run: `pnpm --filter @chitrapx/web exec vitest run test/fonts.test.ts`
Expected: FAIL. `@/server/fonts.ts` is missing, and `kind: "font"` is rejected.

- [ ] **Step 5: `fonts.ts` on the server**

`apps/web/src/server/fonts.ts`:

```ts
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type Db, type FontMeta } from "@chitrapx/db";
import { docFontFamilies, type FontFormat } from "@chitrapx/document";
import type { Ctx } from "./context.ts";
import { HttpError, notFound } from "./http.ts";
import type { ObjectStorage } from "./storage.ts";

export const FONT_QUOTA = { faces: 20, bytes: 50 * 1024 * 1024 };
export type FontFaceRow = { assetId: string; weight: number; italic: boolean; format: FontFormat; url: string };
export type FontFamilyRow = { family: string; faces: FontFaceRow[] };
type FontAsset = typeof schema.assets.$inferSelect & { meta: FontMeta };

const fontsOf = (workspaceId: string) => and(eq(schema.assets.workspaceId, workspaceId), eq(schema.assets.kind, "font"), isNull(schema.assets.appId));
const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

export async function findWorkspaceFont(ctx: Ctx, sha256: string): Promise<FontAsset | undefined> {
  const [row] = await db.select().from(schema.assets).where(and(fontsOf(ctx.workspaceId), eq(schema.assets.sha256, sha256))).limit(1);
  return row as FontAsset | undefined;
}

export async function fontUsage(tx: Db, workspaceId: string): Promise<{ faces: number; bytes: number }> {
  const [row] = await tx.select({ faces: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${schema.assets.bytes}), 0)::bigint` })
    .from(schema.assets).where(fontsOf(workspaceId));
  return { faces: Number(row?.faces ?? 0), bytes: Number(row?.bytes ?? 0) };
}

/** 20 faces or 50 MB per workspace, whichever comes first. Checked at sign time and again under the workspace lock on insert. */
export async function assertFontQuota(tx: Db, ctx: Ctx, addingBytes: number): Promise<void> {
  const u = await fontUsage(tx, ctx.workspaceId);
  if (u.faces + 1 > FONT_QUOTA.faces || u.bytes + addingBytes > FONT_QUOTA.bytes) {
    throw new HttpError(403, "font_quota", `Your workspace has ${u.faces} of ${FONT_QUOTA.faces} fonts and ${mb(u.bytes)} of ${mb(FONT_QUOTA.bytes)}. Delete a font to upload another.`);
  }
}

/** The workspace's font families, each with its faces (lightest first, upright before italic) and 1-hour URLs. */
export async function listFonts(ctx: Ctx, storage: ObjectStorage): Promise<FontFamilyRow[]> {
  const rows = (await db.select().from(schema.assets).where(fontsOf(ctx.workspaceId)).orderBy(asc(schema.assets.createdAt))) as FontAsset[];
  // Paths are rebuilt from workspace and hash, never read from the row.
  const urls = await storage.signedUrls(rows.map((r) => `${ctx.workspaceId}/${r.sha256}`));
  const families = new Map<string, FontFaceRow[]>();
  rows.forEach((r, i) => {
    const faces = families.get(r.meta.family) ?? [];
    faces.push({ assetId: r.id, weight: r.meta.weight, italic: r.meta.italic, format: r.meta.format, url: urls[i] ?? "" });
    families.set(r.meta.family, faces);
  });
  return [...families].map(([family, faces]) => ({ family, faces: faces.sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic)) }))
    .sort((a, b) => a.family.localeCompare(b.family));
}

/** Deletes one face. The last face of a family that any project in the workspace uses cannot go (409, with those projects). */
export async function deleteFont(ctx: Ctx, storage: ObjectStorage, assetId: string): Promise<void> {
  if (!z.uuid().safeParse(assetId).success) throw notFound();
  const [row] = (await db.select().from(schema.assets).where(and(fontsOf(ctx.workspaceId), eq(schema.assets.id, assetId)))) as FontAsset[];
  if (!row) throw notFound();
  const family = row.meta.family;
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.assets)
    .where(and(fontsOf(ctx.workspaceId), sql`${schema.assets.meta}->>'family' = ${family}`))) as [{ n: number }];
  if (Number(n) === 1) {
    const projects = await db.select({ id: schema.projects.id, name: schema.projects.name, doc: schema.projects.doc })
      .from(schema.projects).where(eq(schema.projects.workspaceId, ctx.workspaceId));
    const using = projects.filter((p) => docFontFamilies(p.doc).includes(family)).map(({ id, name }) => ({ id, name }));
    if (using.length) throw new HttpError(409, "font_in_use", `${family} is used in ${using.map((p) => p.name).join(", ")}`, { projects: using });
  }
  await db.delete(schema.assets).where(eq(schema.assets.id, row.id));
  await storage.remove(`${ctx.workspaceId}/${row.sha256}`).catch(() => {});
}
```

The test reads `details.projects`. `HttpError` stores its fourth argument as `details`, and `route()` spreads it into the JSON body.

- [ ] **Step 6: Font sign and complete in `uploads.ts`**

In `apps/web/src/server/uploads.ts`:
- Import `checkFont`, `fontFamilyFor`, `FontRejected`, `lockWorkspace`, `sniffFontType` and `withTx` from `@chitrapx/db`.
- Import `assertFontQuota` and `findWorkspaceFont` from `./fonts.ts`.
- Change the input schemas:

```ts
const uploadKind = z.enum(["screenshot", "image", "recording", "font"]);
// Fonts belong to the workspace (no appId); everything else to an app. The client's mime is ignored for fonts.
const signInput = z.object({
  appId: z.uuid().optional(), kind: uploadKind, size: z.number().int().positive(), mime: z.string().max(200).default(""), sha256,
  embedRights: z.boolean().optional(),
});
const completeInput = z.object({ appId: z.uuid().optional(), kind: uploadKind, sha256, uploadId: z.uuid() });
const FONT_ERRORS = {
  font_restricted: "This font's licence does not allow embedding.",
  font_unreadable: "This file could not be read as a font.",
} as const;
```

At the top of `signUpload`, after `const input = signInput.parse(raw);`:

```ts
  if (input.kind === "font") return signFont(ctx, storage, input);
  if (!input.appId) throw badRequest("app_required");
  const appId = input.appId;
```

In the rest of `signUpload`, use `appId` instead of `input.appId`. At the top of `completeUpload`, add the same dispatch, `if (input.kind === "font") return completeFont(ctx, storage, input);`, followed by the `appId` guard. Then add:

```ts
async function signFont(ctx: Ctx, storage: ObjectStorage, input: z.infer<typeof signInput>) {
  if (input.embedRights !== true) throw new HttpError(400, "embed_rights_required", "Confirm you have the right to embed this font");
  if (input.size > UPLOAD_LIMITS.font) throw tooLarge("font");
  const mine = await findWorkspaceFont(ctx, input.sha256);
  if (mine) return { existing: mine };
  await assertFontQuota(db, ctx, input.size);
  const uploadId = randomUUID();
  return { uploadId, ...(await storage.presignPut(stagingPath(ctx, uploadId), { contentType: "application/octet-stream", contentLength: input.size })) };
}

/** Sniffs and parses the whole font in a sandbox; nothing is stored unless it passes. */
async function completeFont(ctx: Ctx, storage: ObjectStorage, input: z.infer<typeof completeInput>): Promise<Asset> {
  const staging = stagingPath(ctx, input.uploadId);
  const discard = () => storage.remove(staging).catch(() => {});
  const mine = await findWorkspaceFont(ctx, input.sha256);
  if (mine) { await discard(); return mine; }

  const { head: bytes, size } = await readStaged(storage, staging, "font", input.sha256); // HEAD_BYTES.font = the whole file
  const type = sniffFontType(bytes);
  if (!type) { await discard(); throw badRequest("unsupported_type"); }
  const parsed = await checkFont(bytes, type.format).catch(async (err) => {
    await discard();
    throw err instanceof FontRejected ? new HttpError(400, err.code, FONT_ERRORS[err.code]) : err;
  });
  const family = fontFamilyFor(parsed.family);
  const [clash] = await db.select({ id: schema.assets.id }).from(schema.assets).where(and(
    eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.kind, "font"),
    sql`${schema.assets.meta}->>'family' = ${family}`, sql`(${schema.assets.meta}->>'weight')::int = ${parsed.weight}`,
    sql`(${schema.assets.meta}->>'italic')::boolean = ${parsed.italic}`,
  )).limit(1);
  if (clash) { await discard(); throw new HttpError(409, "font_face_exists", `${family} already has a ${parsed.weight}${parsed.italic ? " italic" : ""} face. Delete it first to replace it.`); }

  const path = finalPath(ctx, input.sha256);
  await storage.remove(path).catch(() => {});
  await storage.move(staging, path, { contentType: type.mime });
  return withTx(async ({ db: tx }) => {
    await lockWorkspace(tx, ctx.workspaceId);
    await assertFontQuota(tx, ctx, size).catch(async (err) => { await storage.remove(path).catch(() => {}); throw err; });
    const [inserted] = await tx.insert(schema.assets).values({
      workspaceId: ctx.workspaceId, appId: null, kind: "font", storagePath: path, mime: type.mime, bytes: size, sha256: input.sha256,
      meta: { family, weight: parsed.weight, italic: parsed.italic, format: type.format },
    }).onConflictDoNothing().returning();
    return inserted ?? (await findWorkspaceFont(ctx, input.sha256))!;
  });
}
```

Add `sql` to the `drizzle-orm` import. `findWorkspaceFont` returns the asset row type, which matches `Asset`.

In `apps/web/next.config.ts`, read `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md` first. Then set `serverExternalPackages: ["pg-boss", "fontkit"]`.

- [ ] **Step 7: Routes**

Read `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` before writing these. They follow the existing route pattern (`route()`, `requireContext()`, Promise `params`).

`apps/web/src/app/api/fonts/route.ts`:

```ts
import { requireContext } from "@/server/context.ts";
import { listFonts } from "@/server/fonts.ts";
import { route } from "@/server/http.ts";
import { appStorage } from "@/server/storage.ts";

export const GET = route(async () => listFonts(await requireContext(), appStorage()));
```

`apps/web/src/app/api/fonts/[assetId]/route.ts`:

```ts
import { requireContext } from "@/server/context.ts";
import { deleteFont } from "@/server/fonts.ts";
import { route } from "@/server/http.ts";
import { appStorage } from "@/server/storage.ts";

export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ assetId: string }> }) => {
  await deleteFont(await requireContext(), appStorage(), (await params).assetId);
});
```

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @chitrapx/db test && pnpm --filter @chitrapx/web exec vitest run test/fonts.test.ts test/uploads.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: only `billing.ts:61`.

```bash
git add packages/db apps/web NOTICES.md pnpm-lock.yaml
git commit -m "feat(fonts): workspace font uploads with sniffing, sandboxed fontkit parse, licence check, quota and delete guard"
```

---

### Task 7: Uploaded fonts in the editor (face CSS, render extras, upload dialog)

**Files:**
- Create: `packages/renderer/src/extras.ts`
- Modify: `packages/renderer/src/fonts.tsx` (`customFontFaceCss`, `BoardFonts` faces), `packages/renderer/src/BoardView.tsx`, `packages/renderer/src/VideoFrame.tsx`, `packages/renderer/src/osg/lib/fontService.ts` (`ensureCustomFaces`; `cssFontFamily` fallback for unknown families), `packages/renderer/src/index.ts`
- Create: `apps/web/src/lib/fontFaces.ts`, `apps/web/src/server/renderExtras.ts`, `apps/web/src/editor/ui/FontUploadDialog.tsx`
- Modify: `apps/web/src/lib/uploadAsset.ts` (`uploadFont`, `fontUploadMessage`), `apps/web/src/editor/assets.tsx`, `apps/web/src/editor/Editor.tsx`, `apps/web/src/app/editor/[projectId]/page.tsx`, `apps/web/src/editor/ui/Canvas.tsx:202`, `apps/web/src/editor/ui/Inspector.tsx` (font picker), `apps/web/src/editor/ui/FontPicker.tsx` (custom previews), `apps/web/src/components/BrandForm.tsx`, `apps/web/src/app/dashboard/apps/[appId]/page.tsx`
- Test: `packages/renderer/test/fonts.test.ts` (append), `apps/web/test/fontFaces.test.ts` (create)

**Interfaces:**
- Consumes: `listFonts`, `FontFamilyRow` (Task 6), `FontPicker` (Task 5), `putSigned` (Task 2).
- Produces:
  - In `@chitrapx/renderer`:
    - `type CustomFontFace = { family: string; weight: number; italic: boolean; format: FontFormat; url: string }` and `type RenderExtras = { faces?: CustomFontFace[] }` (Task 12 adds `palette`)
    - `customFontFaceCss(faces: CustomFontFace[]): string` and `ensureCustomFaces(faces: CustomFontFace[]): void`
    - `BoardFonts({ boards, faces? })`, `BoardView` prop `extras?: RenderExtras`, `VideoFrame` prop `extras?: RenderExtras`
  - `facesOf(fonts: FontFamilyRow[], families?: ReadonlySet<string>): CustomFontFace[]` in `@/lib/fontFaces.ts`. It is client-safe.
  - `renderExtras(ctx, storage, opts?: { doc?: ChitrapxDoc }): Promise<RenderExtras>` in `@/server/renderExtras.ts`. With a `doc`, it returns only that document's families.
  - In `@/lib/uploadAsset.ts`: `uploadFont(file: File): Promise<{ id: string; family: string }>` and `fontUploadMessage(err: unknown): string`.
  - `useEditorAssets()` adds `fonts: FontFamilyRow[]`, `extras: RenderExtras` and `refreshFonts(): Promise<void>`.
  - `FontPicker`'s `custom` prop becomes `Array<{ family: string; faces: CustomFontFace[] }>`.

> **Fact (nosniff):** the spec asks signed GETs to add `X-Content-Type-Options: nosniff` "via response header overrides where the provider supports it". S3, R2 and MinIO GetObject overrides cover only Content-Type, Content-Disposition, Cache-Control, Content-Encoding, Content-Language and Expires. None of them supports nosniff.
>
> Instead, fonts are stored with their sniffed `font/*` type (Task 6 `move(..., { contentType })`), and they are only ever loaded through `@font-face`, which never runs or renders the bytes as a document. No code change is needed.

- [ ] **Step 1: Failing tests**

Append to `packages/renderer/test/fonts.test.ts`:

```ts
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { BoardFonts, cssFontFamily, customFontFaceCss, type CustomFontFace } from "../src/index.ts";

const face = (over: Partial<CustomFontFace> = {}): CustomFontFace => ({ family: "Acme Sans", weight: 400, italic: false, format: "woff2", url: "https://s3.example/u/w/abc?X-Amz-Signature=1", ...over });

describe("uploaded font faces", () => {
  it("writes one @font-face per face with block display", () => {
    expect(customFontFaceCss([face(), face({ weight: 700, italic: true, format: "ttf" })])).toBe(
      '@font-face{font-family:"Acme Sans";src:url("https://s3.example/u/w/abc?X-Amz-Signature=1") format("woff2");font-weight:400;font-style:normal;font-display:block}\n' +
      '@font-face{font-family:"Acme Sans";src:url("https://s3.example/u/w/abc?X-Amz-Signature=1") format("truetype");font-weight:700;font-style:italic;font-display:block}');
  });
  it("cannot be broken out of by a hostile family name or URL", () => {
    const css = customFontFaceCss([face({ family: 'Evil"}</style><script>x', url: 'https://x/"); background:url(//evil' })]);
    expect(css).not.toContain("</style>");
    expect(css).toContain('font-family:"Evil\\"}\\3c /style>\\3c script>x"');
    expect(css).toContain('src:url("https://x/\\"); background:url(//evil")');
  });
  it("BoardFonts declares only the uploaded faces the boards use", () => {
    const html = renderToStaticMarkup(createElement(BoardFonts, { boards: [board([text("Acme Sans")])], faces: [face(), face({ family: "Unused Co" })] }));
    expect(html).toContain("Acme Sans");
    expect(html).not.toContain("Unused Co");
  });
  it("a missing family falls back to a generic family instead of the page default", () => {
    expect(cssFontFamily("Acme Sans")).toBe('"Acme Sans", sans-serif');
    expect(cssFontFamily("Playfair Display")).toBe('"Playfair Display", serif');
  });
});
```

`apps/web/test/fontFaces.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiError } from "@/server/api.ts";
import { facesOf } from "@/lib/fontFaces.ts";
import { fontUploadMessage } from "@/lib/uploadAsset.ts";

const rows = [
  { family: "Acme", faces: [{ assetId: "a", weight: 400, italic: false, format: "woff2" as const, url: "u1" }, { assetId: "b", weight: 700, italic: true, format: "woff2" as const, url: "u2" }] },
  { family: "Other", faces: [{ assetId: "c", weight: 400, italic: false, format: "ttf" as const, url: "u3" }] },
];

describe("font faces for the renderer", () => {
  it("flattens families, optionally to the ones a document uses", () => {
    expect(facesOf(rows).map((f) => `${f.family}:${f.weight}:${f.italic}`)).toEqual(["Acme:400:false", "Acme:700:true", "Other:400:false"]);
    expect(facesOf(rows, new Set(["Other"]))).toEqual([{ family: "Other", weight: 400, italic: false, format: "ttf", url: "u3" }]);
  });
  it("explains every upload error in plain words", () => {
    const e = (code: string, message = "server said") => new ApiError(400, code, message);
    expect(fontUploadMessage(e("unsupported_type"))).toBe("This file is not a TTF, OTF, WOFF or WOFF2 font.");
    expect(fontUploadMessage(e("too_large"))).toBe("Fonts can be up to 10 MB.");
    expect(fontUploadMessage(e("font_restricted"))).toBe("This font's licence does not allow embedding.");
    expect(fontUploadMessage(e("font_unreadable"))).toBe("This file could not be read as a font.");
    expect(fontUploadMessage(e("font_quota", "Your workspace has 20 of 20 fonts"))).toBe("Your workspace has 20 of 20 fonts");
    expect(fontUploadMessage(new Error("Upload failed — try again"))).toBe("Upload failed — try again");
  });
});
```

Run: `pnpm --filter @chitrapx/renderer exec vitest run test/fonts.test.ts && pnpm --filter @chitrapx/web exec vitest run test/fontFaces.test.ts`
Expected: FAIL. `customFontFaceCss` and `@/lib/fontFaces.ts` are missing.

- [ ] **Step 2: Renderer**

`packages/renderer/src/extras.ts`:

```ts
import type { FontFormat } from "@chitrapx/document";

/** An uploaded font face as a render page needs it: a signed URL it may load (from the uploads bucket, allow-listed for exports). */
export type CustomFontFace = { family: string; weight: number; italic: boolean; format: FontFormat; url: string };
/** Workspace data a board needs beyond its document. Every render surface (canvas, previews, export, video) receives the same value. */
export type RenderExtras = { faces?: CustomFontFace[] };
```

Add to `packages/renderer/src/fonts.tsx`:

```tsx
import type { FontFormat } from "@chitrapx/document";
import type { CustomFontFace } from "./extras.ts";

const FORMAT: Record<FontFormat, string> = { ttf: "truetype", otf: "opentype", woff: "woff", woff2: "woff2" };
/** A CSS string literal that nothing can leave: quotes and backslashes escaped, "<" as \3c, line breaks dropped. */
const cssString = (s: string) => `"${s.replace(/[\\"]/g, "\\$&").replace(/</g, "\\3c ").replace(/[\n\r\f]/g, "")}"`;

/** One @font-face per uploaded face. display: block, like the Google stylesheet, so exports never capture fallback glyphs. */
export function customFontFaceCss(faces: CustomFontFace[]): string {
  return faces.map((f) => `@font-face{font-family:${cssString(f.family)};src:url(${cssString(f.url)}) format("${FORMAT[f.format]}");font-weight:${Math.round(f.weight)};font-style:${f.italic ? "italic" : "normal"};font-display:block}`).join("\n");
}
```

Replace `BoardFonts`:

```tsx
/** The Google stylesheet for catalogue families plus @font-face rules for the uploaded faces these boards use. */
export function BoardFonts({ boards, faces = [] }: { boards: ArtboardState[]; faces?: CustomFontFace[] }) {
  const uses = fontUsesOf(boards);
  const href = googleFontsHref(uses);
  const used = new Set(uses.map((u) => u.family));
  const css = customFontFaceCss(faces.filter((f) => used.has(f.family)));
  return (
    <>
      {href && <link rel="stylesheet" href={href} precedence="chitrapx-fonts" />}
      {css && <style data-chitrapx-custom-fonts="">{css}</style>}
    </>
  );
}
```

In `packages/renderer/src/BoardView.tsx`, add `extras?: RenderExtras` to `BoardViewProps`, destructure it, and render `<BoardFonts boards={[board]} faces={extras?.faces} />`. In `packages/renderer/src/VideoFrame.tsx`, add `extras?: RenderExtras` to `VideoFrameProps` and pass `faces={extras?.faces}` to `BoardFonts`.

In `packages/renderer/src/osg/lib/fontService.ts`:
- Import `customFontFaceCss` from `'../../fonts.tsx'` and `type CustomFontFace` from `'../../extras.ts'`.
- In `cssFontFamily`, change `return generic ? \`${quoted}, ${generic}\` : quoted;` to `return \`${quoted}, ${generic ?? 'sans-serif'}\`;`. An uploaded family that failed to load, or was deleted, then falls back to a sans instead of the page's default serif.
- Add:

```ts
/** Puts uploaded faces on the page for picker previews: one shared <style>, replaced on each call. */
export function ensureCustomFaces(faces: CustomFontFace[]): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById('chitrapx-picker-faces') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'chitrapx-picker-faces';
    document.head.appendChild(style);
  }
  style.textContent = customFontFaceCss(faces);
}
```

In `packages/renderer/src/index.ts`, export `customFontFaceCss` from `./fonts.tsx`, `ensureCustomFaces` from fontService, and `type CustomFontFace, type RenderExtras` from `./extras.ts`.

- [ ] **Step 3: Server render extras and client helpers**

`apps/web/src/lib/fontFaces.ts`:

```ts
import type { CustomFontFace } from "@chitrapx/renderer";
import type { FontFamilyRow } from "@/server/fonts.ts";

/** The renderer's face list from the font API rows, optionally only the families a document uses. */
export function facesOf(fonts: FontFamilyRow[], families?: ReadonlySet<string>): CustomFontFace[] {
  return fonts.filter((f) => !families || families.has(f.family))
    .flatMap((f) => f.faces.map(({ weight, italic, format, url }) => ({ family: f.family, weight, italic, format, url })));
}
```

`apps/web/src/server/renderExtras.ts`:

```ts
import { docFontFamilies, type ChitrapxDoc } from "@chitrapx/document";
import type { RenderExtras } from "@chitrapx/renderer";
import { facesOf } from "@/lib/fontFaces.ts";
import type { Ctx } from "./context.ts";
import { listFonts } from "./fonts.ts";
import type { ObjectStorage } from "./storage.ts";

/** What every render surface needs beyond the document: the workspace's uploaded font faces (all, or only `doc`'s). */
export async function renderExtras(ctx: Ctx, storage: ObjectStorage, opts: { doc?: ChitrapxDoc } = {}): Promise<RenderExtras> {
  const fonts = await listFonts(ctx, storage);
  return { faces: facesOf(fonts, opts.doc ? new Set(docFontFamilies(opts.doc)) : undefined) };
}
```

Append to `apps/web/src/lib/uploadAsset.ts`:

```ts
import { ApiError } from "@/server/api.ts";

const FONT_MESSAGES: Record<string, string> = {
  unsupported_type: "This file is not a TTF, OTF, WOFF or WOFF2 font.",
  too_large: "Fonts can be up to 10 MB.",
  font_restricted: "This font's licence does not allow embedding.",
  font_unreadable: "This file could not be read as a font.",
  embed_rights_required: "Confirm you have the right to embed this font.",
};

/** The upload dialog's inline message for any failure. Quota and duplicate-face messages come from the server with their counts. */
export function fontUploadMessage(err: unknown): string {
  if (err instanceof ApiError) return FONT_MESSAGES[err.code] ?? err.message;
  return err instanceof Error ? err.message : "Upload failed — try again";
}

/** Uploads one font face into the workspace. The caller has already confirmed the embedding rights. */
export async function uploadFont(file: File): Promise<{ id: string; family: string }> {
  const sha256 = await sha256Hex(file);
  const signed = await api<{ existing?: { id: string; meta?: { family?: string } }; uploadId?: string; url?: string; headers?: Record<string, string> }>(
    "/api/uploads/sign", "POST", { kind: "font", size: file.size, sha256, embedRights: true });
  if (signed.existing) return { id: signed.existing.id, family: signed.existing.meta?.family ?? "" };
  await putSigned({ url: signed.url!, headers: signed.headers! }, file);
  const asset = await api<{ id: string; meta: { family: string } }>("/api/uploads/complete", "POST", { kind: "font", sha256, uploadId: signed.uploadId });
  return { id: asset.id, family: asset.meta.family };
}
```

Merge the new `ApiError` import into the file's existing `api` import line.

- [ ] **Step 4: Upload dialog**

`apps/web/src/editor/ui/FontUploadDialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { fontUploadMessage, uploadFont } from "@/lib/uploadAsset.ts";

/** One font file plus the embedding-rights confirmation; every error is shown inline. */
export function FontUploadDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded: (family: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !rights) return;
    setBusy(true); setError("");
    try { onUploaded((await uploadFont(file)).family); onClose(); }
    catch (err) { setError(fontUploadMessage(err)); }
    finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="font-upload-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <form onSubmit={submit} className="card w-96 space-y-3">
        <h2 id="font-upload-title" className="font-semibold">Upload a font</h2>
        <p className="text-xs text-neutral-500">TTF, OTF, WOFF or WOFF2, up to 10 MB. One file is one weight or style. Fonts are shared by every app in this workspace.</p>
        <input type="file" accept=".ttf,.otf,.woff,.woff2" aria-label="Font file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />
          I have the right to embed this font in images I publish.
        </label>
        {error && <p role="alert" className="error text-xs">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={!file || !rights || busy}>{busy ? "Uploading" : "Upload"}</button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Wire it into the editor and the brand form**

In `apps/web/src/editor/assets.tsx`, extend the provider:

```tsx
import type { RenderExtras } from "@chitrapx/renderer";
import { facesOf } from "@/lib/fontFaces.ts";
import type { FontFamilyRow } from "@/server/fonts.ts";

type Value = { appId: string; assets: PickerAsset[]; resolveSrc: ResolveSrc; refresh(): Promise<PickerAsset[]>;
  fonts: FontFamilyRow[]; extras: RenderExtras; refreshFonts(): Promise<void> };

// props gain: fonts: FontFamilyRow[]; extras: RenderExtras
  const [fonts, setFonts] = useState(initialFonts);
  const [extras, setExtras] = useState(initialExtras);
  const refreshFonts = useCallback(async () => {
    const rows = await api<FontFamilyRow[]>("/api/fonts");
    setFonts(rows);
    setExtras((e) => ({ ...e, faces: facesOf(rows) }));
  }, []);
  const value = useMemo(() => ({ appId, assets, resolveSrc, refresh, fonts, extras, refreshFonts }), [appId, assets, resolveSrc, refresh, fonts, extras, refreshFonts]);
```

In `apps/web/src/app/editor/[projectId]/page.tsx`, after the asset lines:

```tsx
  const fonts = await listFonts(ctx, storage);
  // ... <Editor ... fonts={fonts} extras={{ faces: facesOf(fonts) }} />
```

Import `listFonts` from `@/server/fonts.ts` and `facesOf` from `@/lib/fontFaces.ts`. `Editor.tsx` takes `fonts` and `extras` props and passes them to `EditorAssetsProvider`.

In `apps/web/src/editor/ui/Canvas.tsx:202`, read `const { resolveSrc, extras } = useEditorAssets();` (it already reads `resolveSrc` from the hook) and add `extras={extras}` to `BoardView`.

In `apps/web/src/editor/ui/FontPicker.tsx`:
- Change the `custom` prop type to `Array<{ family: string; faces: CustomFontFace[] }>`, importing `type CustomFontFace` and `ensureCustomFaces` from `@chitrapx/renderer`.
- Add `useEffect(() => { if (open) ensureCustomFaces(custom.flatMap((c) => c.faces)); }, [open, custom]);`.

In `Inspector.tsx`'s `ElementInspector`:

```tsx
  const { fonts, refreshFonts } = useEditorAssets();
  const [uploadingFont, setUploadingFont] = useState(false);
  const custom = useMemo(() => fonts.map((f) => ({ family: f.family, faces: facesOf([f]) })), [fonts]);
  // FontPicker gains: custom={custom} onUpload={() => setUploadingFont(true)}
  // after the text section:
  {uploadingFont && <FontUploadDialog onClose={() => setUploadingFont(false)}
    onUploaded={async (family) => { await refreshFonts(); if (family) setLocalizable("fontFamily", family); }} />}
```

In `apps/web/src/app/dashboard/apps/[appId]/page.tsx`, load `const fonts = await listFonts(ctx, appStorage());` (inside the existing `Promise.all`) and pass `fonts={fonts}` to `BrandForm`. In `BrandForm`:
- Accept `fonts: FontFamilyRow[]`.
- Compute `custom` as in the inspector.
- Pass `custom` and `onUpload={() => setUploading(true)}` to both FontPickers.
- Render `FontUploadDialog` with `onUploaded={() => router.refresh()}`.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @chitrapx/renderer test && pnpm --filter @chitrapx/web exec vitest run test/fontFaces.test.ts test/fonts.test.ts`
Expected: PASS.

- [ ] **Step 7: Browser check**

Start the web dev server with the dev-server commands in Global Constraints. In the editor, select a text and open Font → Your fonts → Upload font. Upload `packages/db/test/fixtures/fonts/pacifico.woff2` with the box ticked.
- "Pacifico (custom)" is selected and the canvas text changes.
- Upload it again: no error, same family.
- Upload a renamed `.txt` file: the dialog shows "This file is not a TTF, OTF, WOFF or WOFF2 font."
- Without the box ticked, Upload stays disabled.

Stop the server by PID.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: only `billing.ts:61`.

```bash
git add packages/renderer apps/web
git commit -m "feat(fonts): uploaded faces render in the editor; upload dialog with rights check and inline errors"
```

---

### Task 8: Uploaded fonts in export, video and bundles (plus the missing-font check)

**Files:**
- Modify: `apps/web/src/app/render/[jobId]/page.tsx`, `apps/web/src/components/RenderSheet.tsx`, `apps/web/src/components/VideoSheet.tsx`
- Modify: `apps/web/src/app/dashboard/projects/[projectId]/page.tsx`, `.../preview/page.tsx`, `apps/web/src/components/{ProjectBoards,StorePreview,BoardThumb,VideoPanel}.tsx` (pass `extras` through)
- Modify: `packages/document/src/readiness.ts` (`contentChecks`), `packages/document/src/bundle.ts` (font manifest entries, `extFor`)
- Modify: `apps/web/src/editor/ui/Checks.tsx`, `apps/web/src/editor/ui/Toolbar.tsx:70`, `apps/web/src/components/ExportDialog.tsx` (`checks` prop)
- Modify: `apps/worker/src/bundle.ts` (fonts in `runBundle` and `runImport`)
- Test: `packages/document/test/readiness.test.ts` (append), `packages/document/test/bundle.test.ts` (append), `apps/worker/test/bundle.test.ts` (append), `apps/worker/test-e2e/export.test.ts` (append)
- Golden: `packages/assets/golden/custom-font-woff2.png` (create)

**Interfaces:**
- Consumes: `renderExtras` (Task 7), `checkFont`, `fontFamilyFor`, `sniffFontType`, `FontRejected` (Task 6), `docFontFamilies` (Task 5).
- Produces:
  - `type ContentIssue = { severity: "warning"; code: "font_missing" | "brand_token_unset" | "placeholder"; message: string; groupId: string; boardIndex: number }`
  - `type ContentContext = { customFamilies: readonly string[] }`. Task 12 adds `palette`.
  - `contentChecks(doc, ctx): ContentIssue[]`. Task 8 emits `font_missing`. Tasks 12 and 14 add the other two codes.
  - `BundleManifest.assets[]` gains `kind: "font"` with `family`, `weight` and `italic`.
  - `extFor` maps `font/ttf|otf|woff|woff2`.
  - `RenderSheet`, `VideoSheet`, `ProjectBoards`, `StorePreview`, `BoardThumb` and `VideoPanel` take `extras?: RenderExtras`. `ExportDialog` takes `checks?: ContentIssue[]`.

> **Ruling (bundle import collisions):** an imported face uses the bundle's family name. That name already carries ` (custom)` from the source workspace, and must equal `fontFamilyFor(parsed name)`, or the import fails `bundle_asset_mismatch`. If the target workspace already has a face with the same family, weight and style, that face is kept and the imported one is not inserted. The document refers to families by name, so it still renders. The import fails `font_quota` if the new faces would exceed the target's quota.

- [ ] **Step 1: Failing document tests**

Append to `packages/document/test/readiness.test.ts`:

```ts
import { contentChecks } from "../src/index.ts";

describe("contentChecks: fonts", () => {
  it("warns once per family that is neither built in nor uploaded", () => {
    const b1 = board("b1", [{ ...text("t", 0, 0), fontFamily: "Gone Sans" } as never, { ...text("u", 0, 300), fontFamily: "Mine (custom)" } as never]);
    const b2 = board("b2", [{ ...text("t2", 0, 0), fontFamily: "Gone Sans" } as never]);
    b2.localized = { "de-DE": { t2: { fontFamily: "Also Gone" } } };
    const issues = contentChecks(doc([group([b1, b2])]), { customFamilies: ["Mine (custom)"] });
    expect(issues).toEqual([
      { severity: "warning", code: "font_missing", message: "Font Gone Sans is missing", groupId: "g1", boardIndex: 0 },
      { severity: "warning", code: "font_missing", message: "Font Also Gone is missing", groupId: "g1", boardIndex: 1 },
    ]);
    expect(contentChecks(doc([group([board("b", [text("t", 0, 0)])])]), { customFamilies: [] })).toEqual([]); // Inter is in the catalogue
  });
});
```

Append to `packages/document/test/bundle.test.ts`:

```ts
describe("font entries", () => {
  const base = { format: "chitrapx-project", version: 1, docSchema: 1, appName: "A", exportedAt: "2026-10-05T00:00:00Z" };
  it("accepts a font with family, weight and italic and maps its extension", () => {
    const m = bundleManifestSchema.parse({ ...base, assets: [{ sha256: "a".repeat(64), kind: "font", mime: "font/woff2", family: "Acme (custom)", weight: 700, italic: false }] });
    expect(m.assets[0]).toMatchObject({ kind: "font", family: "Acme (custom)" });
    expect(["font/ttf", "font/otf", "font/woff", "font/woff2"].map(extFor)).toEqual(["ttf", "otf", "woff", "woff2"]);
  });
  it("rejects a font entry without its face description", () => {
    expect(bundleManifestSchema.safeParse({ ...base, assets: [{ sha256: "a".repeat(64), kind: "font", mime: "font/woff2" }] }).success).toBe(false);
  });
});
```

Make sure `bundleManifestSchema` and `extFor` are imported in that file.

Run: `pnpm --filter @chitrapx/document exec vitest run test/readiness.test.ts test/bundle.test.ts`
Expected: FAIL.

- [ ] **Step 2: `contentChecks` and bundle manifest**

Append to `packages/document/src/readiness.ts`:

```ts
import { docFontFamilies } from "./docFonts.ts";
import { isReservedFamily } from "./fontCatalog.ts";

/** Pre-export checks on the document's content (not store rules): shown in the editor's Checks and the export dialog. */
export type ContentIssue = {
  severity: "warning"; code: "font_missing" | "brand_token_unset" | "placeholder"; message: string; groupId: string; boardIndex: number;
};
export type ContentContext = { customFamilies: readonly string[] };

export function contentChecks(doc: ChitrapxDoc, ctx: ContentContext): ContentIssue[] {
  const out: ContentIssue[] = [];
  const uploaded = new Set(ctx.customFamilies);
  const reported = new Set<string>();
  for (const g of doc.groups) {
    const perBoard: Array<[number, unknown]> = [[0, g.spanElements], ...g.boards.map((b, i) => [i, b] as [number, unknown])];
    for (const [boardIndex, part] of perBoard) {
      for (const family of docFontFamilies(part)) {
        if (reported.has(family) || isReservedFamily(family) || uploaded.has(family)) continue;
        reported.add(family);
        out.push({ severity: "warning", code: "font_missing", message: `Font ${family} is missing`, groupId: g.id, boardIndex });
      }
    }
  }
  return out;
}
```

In `packages/document/src/bundle.ts`, replace the `assets` entry of `bundleManifestSchema`:

```ts
  assets: z.array(z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(["screenshot", "image", "recording", "font"]),
    mime: z.string().max(100),
    // Fonts are referenced by family name in the document, so the manifest carries the face they provide.
    family: z.string().min(1).max(100).optional(),
    weight: z.number().int().min(1).max(1000).optional(),
    italic: z.boolean().optional(),
  }).refine((a) => a.kind !== "font" || (a.family !== undefined && a.weight !== undefined && a.italic !== undefined), { message: "A font needs family, weight and italic" }))
    .max(MAX_BUNDLE_ENTRIES),
```

Extend `EXT` with `"font/ttf": "ttf", "font/otf": "otf", "font/woff": "woff", "font/woff2": "woff2"`.

Run: `pnpm --filter @chitrapx/document test`
Expected: PASS.

- [ ] **Step 3: Worker bundle tests (failing)**

Append to `apps/worker/test/bundle.test.ts`:

```ts
import { and, isNull } from "drizzle-orm";
import { fixtureFont } from "../../../packages/db/test/fontFixtures.ts";

async function projectWithFont() {
  const p = await projectWithAsset();
  const bytes = fixtureFont("pacifico.woff2");
  const hash = sha(bytes);
  await db.insert(schema.assets).values({ workspaceId: p.ws, appId: null, kind: "font", storagePath: `${p.ws}/${hash}`, mime: "font/woff2", bytes: bytes.length, sha256: hash,
    meta: { family: "Pacifico (custom)", weight: 400, italic: false, format: "woff2" } });
  p.deps.files.set(`${p.ws}/${hash}`, bytes);
  const [row] = await db.select().from(schema.projects).where(eq(schema.projects.workspaceId, p.ws));
  const doc = row!.doc as { groups: Array<{ boards: Array<{ elements: unknown[] }> }> };
  doc.groups[0]!.boards[0]!.elements.push({ id: "t", type: "text", content: "Hello", fontSize: 40, color: "#000", fontFamily: "Pacifico (custom)", position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, rotation: 0, scale: 1 });
  await db.update(schema.projects).set({ doc }).where(eq(schema.projects.id, row!.id));
  return { ...p, fontSha: hash, fontBytes: bytes };
}

describe("fonts in project files", () => {
  it("packs the faces of every uploaded family the document uses", async () => {
    const p = await projectWithFont();
    await runJob(p.jobId, (input, job) => runBundle(input, job, p.deps));
    const zip = unzipSync(new Uint8Array(p.deps.files.get(`exports:${p.ws}/${p.jobId}.chitrapx`)!));
    const manifest = JSON.parse(strFromU8(zip["manifest.json"]!));
    expect(manifest.assets).toContainEqual({ sha256: p.fontSha, kind: "font", mime: "font/woff2", family: "Pacifico (custom)", weight: 400, italic: false });
    expect(zip[`assets/${p.fontSha}.woff2`]).toBeDefined();
  });

  it("restores them into another workspace as workspace fonts, once", async () => {
    const p = await projectWithFont();
    await runJob(p.jobId, (input, job) => runBundle(input, job, p.deps));
    const file = p.deps.files.get(`exports:${p.ws}/${p.jobId}.chitrapx`)!;
    const target = await makeWorkspace((await createUser()).id, "pro");
    const [app] = await db.insert(schema.apps).values({ workspaceId: target, name: "T" }).returning();
    for (let i = 0; i < 2; i++) {
      const uploadId = crypto.randomUUID();
      p.deps.files.set(`staging/${target}/${uploadId}`, file);
      const [job] = await db.insert(schema.jobs).values({ workspaceId: target, type: "project_import", creditsReserved: 0, input: { appId: app!.id, uploadId, name: `Copy ${i}` } }).returning();
      await runJob(job!.id, (input, ctx) => runImport(input, ctx, p.deps, async () => {}));
      expect((await jobRow(job!.id)).status).toBe("done");
    }
    const fonts = await db.select().from(schema.assets).where(and(eq(schema.assets.workspaceId, target), eq(schema.assets.kind, "font"), isNull(schema.assets.appId)));
    expect(fonts.map((f) => f.meta)).toEqual([{ family: "Pacifico (custom)", weight: 400, italic: false, format: "woff2" }]);
    expect(p.deps.files.has(`uploads:${target}/${p.fontSha}`)).toBe(true);
  });

  it("refuses a font whose bytes are not the family the manifest claims", async () => {
    const bytes = fixtureFont("inter-400.woff2"); // really "Inter (custom)"
    const zip = packBundle(manifest({ assets: [{ sha256: sha(bytes), kind: "font", mime: "font/woff2", family: "Pacifico (custom)", weight: 400, italic: false }] }) as never,
      docWith("") as never, { [`assets/${sha(bytes)}.woff2`]: bytes });
    await fails(zip, "bundle_asset_mismatch");
  });
});
```

`manifest`, `docWith`, `fails`, `projectWithAsset` and `jobRow` are the existing helpers in this file. Check that `docWith("")` builds a valid document with no `bundle:` reference. If it does not, build a plain one-board document inline. Import `createUser` and `makeWorkspace` if they are not already imported.

Run: `pnpm --filter @chitrapx/worker exec vitest run test/bundle.test.ts`
Expected: FAIL. Fonts are not bundled, and `"font"` is not in `BUNDLE_KINDS`.

- [ ] **Step 4: Worker bundle code**

In `apps/worker/src/bundle.ts`:
- Import `checkFont`, `fontFamilyFor`, `FontRejected` and `sniffFontType` from `@chitrapx/db`.
- Import `docFontFamilies` from `@chitrapx/document`.
- Import `isNull` and `sql` from `drizzle-orm`.

Then make these changes.

```ts
const BUNDLE_KINDS: readonly string[] = ["screenshot", "image", "recording", "font"];
const FONT_QUOTA = { faces: 20, bytes: 50 * 1024 * 1024 }; // same as apps/web/src/server/fonts.ts
```

In `runBundle`, after `const byId = …`:

```ts
  const families = docFontFamilies(doc);
  const fonts = families.length ? await db.select().from(schema.assets).where(and(
    eq(schema.assets.workspaceId, job.workspaceId), eq(schema.assets.kind, "font"), isNull(schema.assets.appId),
    inArray(sql<string>`${schema.assets.meta}->>'family'`, families))) : [];
```

Change `const unique = …` to `[...new Map([...assets, ...fonts].map((a) => [a.sha256, a])).values()]`. Change the manifest `assets` mapping to:

```ts
    assets: unique.map((a) => a.kind === "font"
      ? { sha256: a.sha256, kind: "font" as const, mime: a.mime, family: a.meta!.family!, weight: a.meta!.weight!, italic: a.meta!.italic! }
      : { sha256: a.sha256, kind: a.kind as BundleAssetKind, mime: a.mime }),
```

Extend `CheckedAsset` with `font?: { family: string; weight: number; italic: boolean; format: "ttf" | "otf" | "woff" | "woff2" }`. In `readBundleUnsafe`'s asset loop, replace the sniff with:

```ts
    if (a.kind === "font") {
      const type = sniffFontType(bytes);
      if (!type || type.mime !== a.mime) return fail("bundle_asset_mismatch");
      const parsed = await checkFont(bytes, type.format).catch((err) => fail(err instanceof FontRejected ? err.code : "bundle_asset_mismatch"));
      if (a.family !== fontFamilyFor(parsed.family)) return fail("bundle_asset_mismatch");
      assets.push({ ...a, bytes, font: { family: a.family, weight: parsed.weight, italic: parsed.italic, format: type.format } });
      continue;
    }
    const sniffed = await sniffAsset(a.kind, bytes.subarray(0, HEAD_BYTES[a.kind]));
```

Leave the rest of the loop unchanged. In `runImport`'s transaction, before `const idOf`:

```ts
      const newFonts = assets.filter((a) => a.font);
      if (newFonts.length) {
        const [u] = await tx.db.select({ faces: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${schema.assets.bytes}), 0)::bigint` })
          .from(schema.assets).where(and(eq(schema.assets.workspaceId, job.workspaceId), eq(schema.assets.kind, "font"), isNull(schema.assets.appId)));
        const existing = await tx.db.select({ sha: schema.assets.sha256, meta: schema.assets.meta }).from(schema.assets)
          .where(and(eq(schema.assets.workspaceId, job.workspaceId), eq(schema.assets.kind, "font"), isNull(schema.assets.appId)));
        const sameFace = (f: NonNullable<CheckedAsset["font"]>) => existing.some((e) => e.meta?.family === f.family && e.meta?.weight === f.weight && e.meta?.italic === f.italic);
        const toAdd = newFonts.filter((a) => !existing.some((e) => e.sha === a.sha256) && !sameFace(a.font!));
        if (Number(u!.faces) + toAdd.length > FONT_QUOTA.faces || Number(u!.bytes) + toAdd.reduce((n, a) => n + a.bytes.byteLength, 0) > FONT_QUOTA.bytes) fail("font_quota");
        for (const a of toAdd) {
          await tx.db.insert(schema.assets).values({ workspaceId: job.workspaceId, appId: null, kind: "font", storagePath: `${job.workspaceId}/${a.sha256}`,
            mime: a.mime, bytes: a.bytes.byteLength, sha256: a.sha256, meta: a.font! }).onConflictDoNothing();
        }
      }
```

Change the existing per-app insert loop from `for (const a of assets)` to `for (const a of assets.filter((x) => !x.font))`. Fonts are not referenced by `bundle:` strings, so they never enter `idOf`.

Run: `pnpm --filter @chitrapx/worker test`
Expected: PASS.

- [ ] **Step 5: Render pages and previews get the faces**

In `apps/web/src/app/render/[jobId]/page.tsx`, import `renderExtras` and pass `extras` to both sheets:

```tsx
    const extras = await renderExtras(jobCtx, appStorage(), { doc });
    return <VideoSheet ... extras={extras} />;
  // ...
  const extras = await renderExtras(jobCtx, appStorage(), { doc: src.doc });
  return <RenderSheet ... extras={extras} />;
```

- In `RenderSheet.tsx`, add `extras?: RenderExtras` to the props and render `<BoardFonts boards={...} faces={extras?.faces} />`.
- In `VideoSheet.tsx`, add `extras?: RenderExtras` and pass it to every `<VideoFrame … extras={extras} />`.
- Dashboard project page and preview page: compute `const extras = await renderExtras(ctx, appStorage(), { doc: project.doc });` and pass `extras` to `ProjectBoards`, `StorePreview` and `VideoPanel`.
- Those components pass it to `BoardThumb` or `VideoFrame`, and `BoardThumb` passes it to `BoardView`.

`waitForRender` already awaits `document.fonts.ready`, and `font-display: block` makes that wait cover the uploaded faces. The faces come from the uploads bucket, whose origin is in `exportOrigins()` (Task 3).

- [ ] **Step 6: Show the checks**

In `apps/web/src/editor/ui/Checks.tsx`:

```tsx
  const { fonts } = useEditorAssets();
  const content = useMemo(() => contentChecks(doc, { customFamilies: fonts.map((f) => f.family) }).filter((i) => i.groupId === groupId), [doc, fonts, groupId]);
```

List these issues above the existing ones in the same style, labelled "Check". Clicking one runs `store.getState().setActiveBoard(group.boards[i.boardIndex]!.id)`. Include them in the count.

In `ExportDialog.tsx`, accept `checks?: ContentIssue[]`. When it is non-empty, render this block above the store section:

```tsx
        {checks && checks.length > 0 && (
          <section className="space-y-1 text-xs">
            <h3 className="label">Before you export</h3>
            <ul>{checks.map((c, k) => <li key={k}><span className="text-amber-600">Check</span> {c.message}</li>)}</ul>
          </section>
        )}
```

In `Toolbar.tsx`, compute `checks` the same way as `Checks.tsx` (`useEditorAssets().fonts`) and pass it to `ExportDialog`.

- [ ] **Step 7: E2E: custom font golden, fallback check and bundle round trip into another workspace**

Append to `apps/worker/test-e2e/export.test.ts`:

```ts
import { fixtureFont } from "../../../packages/db/test/fontFixtures.ts";

/** Exports board 0 of `doc` as a single PNG in `ws` and returns it. */
async function singleBoardPng(ws: string, appId: string, doc: ChitrapxDoc) {
  const g = doc.groups[0]!;
  const id = await newProject(ws, appId, doc);
  const j = await pinnedExport(ws, id, { targets: [g.target], locales: [doc.localization.baseLocale], board: { groupId: g.id, boardIndex: 0 } }, "export_single");
  await runJob(j, (input, job) => runExport(input, job, "single"));
  expect((await jobRow(j)).status).toBe("done");
  return storage().download(`${ws}/${j}.png`, EXPORTS_BUCKET);
}

/** Uploads pacifico.woff2 as the workspace font "Pacifico (custom)". */
async function installPacifico(ws: string) {
  const bytes = fixtureFont("pacifico.woff2");
  const hash = createHash("sha256").update(bytes).digest("hex");
  await storage().put(`${ws}/${hash}`, bytes, "font/woff2");
  await db.insert(schema.assets).values({ workspaceId: ws, appId: null, kind: "font", storagePath: `${ws}/${hash}`, mime: "font/woff2", bytes: bytes.length, sha256: hash,
    meta: { family: "Pacifico (custom)", weight: 400, italic: false, format: "woff2" } });
}

/** amoura's first headline set to "Hello Chitrapx" (letters the fixture subset covers) in `family`. */
async function headlineIn(family: string): Promise<ChitrapxDoc> {
  const doc = await templateDoc("amoura-dating");
  const t = doc.groups[0]!.boards[0]!.elements.find((e) => e.type === "text") as Record<string, unknown>;
  Object.assign(t, { content: "Hello Chitrapx", fontFamily: family, fontWeight: "400", fontStyle: "normal" });
  return doc;
}

describe("uploaded fonts (SP10)", () => {
  it("a headline in an uploaded woff2 matches its golden and is not the fallback face", async () => {
    const { ws, appId } = await workspaceWithApp();
    await installPacifico(ws);
    const png = await singleBoardPng(ws, appId, await headlineIn("Pacifico (custom)"));
    compareGolden("custom-font-woff2.png", png);
    const fallback = PNG.sync.read(await singleBoardPng(ws, appId, await headlineIn("Not Uploaded (custom)")));
    const actual = PNG.sync.read(png);
    expect(pixelmatch(actual.data, fallback.data, null, actual.width, actual.height, { threshold: 0.1 })).toBeGreaterThan(500);
  }, 240_000);

  it("a project file carries its font into another workspace and renders the same", async () => {
    const source = await workspaceWithApp();
    await installPacifico(source.ws);
    const doc = await headlineIn("Pacifico (custom)");
    const sourceId = await newProject(source.ws, source.appId, doc);
    const [bundleJob] = await db.insert(schema.jobs).values({ workspaceId: source.ws, projectId: sourceId, type: "project_bundle", creditsReserved: 0 }).returning();
    await runJob(bundleJob!.id, (input, job) => runBundle(input, job, bundleDeps));
    const file = await storage().download(`${source.ws}/${bundleJob!.id}.chitrapx`, EXPORTS_BUCKET);

    const target = await workspaceWithApp();
    const uploadId = crypto.randomUUID();
    await storage().put(`staging/${target.ws}/${uploadId}`, file, "application/zip");
    const [importJob] = await db.insert(schema.jobs).values({ workspaceId: target.ws, type: "project_import", creditsReserved: 0, input: { appId: target.appId, uploadId, name: "Copy" } }).returning();
    await runJob(importJob!.id, (input, job) => runImport(input, job, bundleDeps, async () => {}));
    expect((await jobRow(importJob!.id)).status).toBe("done");
    const [copy] = await db.select().from(schema.projects).where(eq(schema.projects.id, ((await jobRow(importJob!.id)).output as { projectId: string }).projectId));

    const a = PNG.sync.read(await singleBoardPng(source.ws, source.appId, doc));
    const b = PNG.sync.read(await singleBoardPng(target.ws, target.appId, migrate(copy!.doc)));
    expect(pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 }) / (a.width * a.height)).toBeLessThan(0.0005);
  }, 300_000);
});
```

Import `runBundle` and `runImport` if they are not already imported in this file. The file already imports `createHash`, `PNG`, `pixelmatch` and `migrate`.

Run the e2e suite with the web server started by the dev-server commands in Global Constraints. On the first run, `compareGolden` writes `custom-font-woff2.png`. Open it: "Hello Chitrapx" must be in Pacifico's brush script, not a sans fallback. Then rerun the whole suite. Expected: PASS, with every other golden unchanged. Stop the server by PID.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS, apart from the known `billing.ts:61` typecheck error.

```bash
git add packages/document apps/web apps/worker packages/assets/golden
git commit -m "feat(fonts): uploaded faces in exports, videos, previews and project files; missing-font check"
```

---

### Task 9: Rich text logic and schema

**Files:**
- Create: `packages/document/src/gradient.ts`, `packages/document/src/richText.ts`
- Modify: `packages/document/src/artboard.ts` (`TextElementProps`, `ElementLocaleOverride`), `packages/document/src/doc.ts` (`BoardGroup.styleId`, group schema, `cssSafe` fontFamily rule, mark and gradient normalisation), `packages/document/src/index.ts`
- Modify: `apps/web/src/server/apps.ts:7` (brand font names use the same rule)
- Modify: `NOTICES.md` (PixelDeck row)
- Test: `packages/document/test/richText.test.ts` (create), `packages/document/test/sp10-schema.test.ts` (create), `apps/web/test/apps.test.ts` (append)

**Interfaces:**
- Produces (from `@chitrapx/document`):
  - `type GradientStop = { color: string; at: number }` and `type Gradient = { kind: "linear" | "radial"; angle?: number; stops: GradientStop[] }`
  - `normalizeGradient(raw: unknown): Gradient | undefined`. It keeps 2–8 stops sorted by `at`, clamps `at` to 0–1, and defaults a linear `angle` to 180.
  - `gradientCss(g: Gradient): string`
  - `type MarkStyle = { color?: string; gradient?: Gradient; fontWeight?: number; italic?: boolean }`, `type TextMark = MarkStyle & { start: number; end: number }`, `MARK_KEYS`
  - `type StylePatch = { [K in keyof MarkStyle]?: MarkStyle[K] | null }`
  - `normalizeMarks(marks, length): TextMark[]`
  - `applyMark(marks, range: { start: number; end: number }, style: StylePatch): TextMark[]`. A colour and a gradient on the same letters replace each other.
  - `clearMark(marks, range, keys?: readonly (keyof MarkStyle)[]): TextMark[]`
  - `rangeStyle(marks, range): { [K in keyof MarkStyle]: MarkStyle[K] | "mixed" | undefined }`
  - `segments(content, marks?): Array<{ start: number; end: number; text: string; style: MarkStyle }>`
  - `remapMarks(oldContent, newContent, marks?): TextMark[]`
  - `TextElementProps.marks?: TextMark[]`, `TextElementProps.gradient?: Gradient`, `ElementLocaleOverride.marks?: TextMark[]`, `BoardGroup.styleId?: string`

> **Ruling (remap rules):** the edited region is found by common prefix and suffix. A mark before it keeps its offsets, and a mark after it shifts by the length change. A mark that strictly contains the region (typing inside a styled word) grows or shrinks with it. A mark entirely inside a deleted or replaced region is dropped. A mark that partly overlaps the region is clipped to the part outside it. Typing exactly at a mark's start or end leaves the new letters unstyled.

- [ ] **Step 1: Failing tests**

`packages/document/test/richText.test.ts` adapts PixelDeck's `richText.test.ts` (MIT) and adds remap cases:

```ts
import { describe, expect, it } from "vitest";
import { applyMark, clearMark, gradientCss, normalizeGradient, normalizeMarks, rangeStyle, remapMarks, segments, type Gradient, type TextMark } from "../src/index.ts";

const G: Gradient = { kind: "linear", angle: 90, stops: [{ color: "#ff0000", at: 0 }, { color: "#0000ff", at: 1 }] };

describe("normalizeMarks", () => {
  it("clamps, drops empty ranges, merges equal neighbours", () => {
    expect(normalizeMarks([{ start: -3, end: 4, fontWeight: 700 }, { start: 4, end: 8, fontWeight: 700 }, { start: 6, end: 6, italic: true }, { start: 18, end: 99, italic: true }], 20))
      .toEqual([{ start: 0, end: 8, fontWeight: 700 }, { start: 18, end: 20, italic: true }]);
  });
  it("splits overlaps, later marks winning per key", () => {
    expect(normalizeMarks([{ start: 0, end: 10, color: "#ff0000" }, { start: 5, end: 15, color: "#00ff00", italic: true }], 20))
      .toEqual([{ start: 0, end: 5, color: "#ff0000" }, { start: 5, end: 15, color: "#00ff00", italic: true }]);
  });
  it("drops marks with no style or unusable offsets, and garbage style values", () => {
    expect(normalizeMarks([{ start: 0, end: 5 }, { start: "a", end: 3, italic: true } as never, { start: 1, end: 2, fontWeight: "heavy" } as never], 10)).toEqual([]);
  });
  it("a later colour replaces an earlier gradient on the same letters", () => {
    expect(normalizeMarks([{ start: 0, end: 4, gradient: G }, { start: 2, end: 4, color: "#00ff00" }], 4))
      .toEqual([{ start: 0, end: 2, gradient: G }, { start: 2, end: 4, color: "#00ff00" }]);
  });
});

describe("applyMark / clearMark / rangeStyle", () => {
  it("styles a range, splitting the marks it crosses", () => {
    expect(applyMark([{ start: 0, end: 10, fontWeight: 700 }], { start: 3, end: 6 }, { italic: true }))
      .toEqual([{ start: 0, end: 3, fontWeight: 700 }, { start: 3, end: 6, fontWeight: 700, italic: true }, { start: 6, end: 10, fontWeight: 700 }]);
  });
  it("swaps a gradient for a colour, and null removes a key", () => {
    const withGradient = applyMark([], { start: 0, end: 4 }, { gradient: G });
    expect(withGradient).toEqual([{ start: 0, end: 4, gradient: G }]);
    expect(applyMark(withGradient, { start: 0, end: 4 }, { color: "#00ff00" })).toEqual([{ start: 0, end: 4, color: "#00ff00" }]);
    expect(applyMark([{ start: 0, end: 4, fontWeight: 700, italic: true }], { start: 0, end: 4 }, { italic: null })).toEqual([{ start: 0, end: 4, fontWeight: 700 }]);
  });
  it("an empty range changes nothing", () => {
    const marks: TextMark[] = [{ start: 0, end: 3, italic: true }];
    expect(applyMark(marks, { start: 2, end: 2 }, { fontWeight: 900 })).toEqual(marks);
  });
  it("clears chosen keys or all of them", () => {
    const marks: TextMark[] = [{ start: 0, end: 10, fontWeight: 700, italic: true }];
    expect(clearMark(marks, { start: 2, end: 4 }, ["italic"])).toEqual([{ start: 0, end: 2, fontWeight: 700, italic: true }, { start: 2, end: 4, fontWeight: 700 }, { start: 4, end: 10, fontWeight: 700, italic: true }]);
    expect(clearMark(marks, { start: 0, end: 10 })).toEqual([]);
  });
  it("reports the common style of a range, or mixed", () => {
    const marks: TextMark[] = [{ start: 0, end: 5, fontWeight: 700 }, { start: 5, end: 10, italic: true }];
    expect(rangeStyle(marks, { start: 3, end: 7 })).toEqual({ color: undefined, gradient: undefined, fontWeight: "mixed", italic: "mixed" });
    expect(rangeStyle(marks, { start: 0, end: 5 })).toEqual({ color: undefined, gradient: undefined, fontWeight: 700, italic: undefined });
    expect(rangeStyle(marks, { start: 6, end: 6 })).toMatchObject({ italic: true }); // caret: the letter after it
  });
});

describe("segments", () => {
  it("covers the whole content, unstyled gaps included", () => {
    expect(segments("Hello world", [{ start: 6, end: 11, fontWeight: 700 }])).toEqual([
      { start: 0, end: 6, text: "Hello ", style: {} },
      { start: 6, end: 11, text: "world", style: { fontWeight: 700 } },
    ]);
    expect(segments("", [{ start: 0, end: 3, italic: true }])).toEqual([]);
  });
});

describe("remapMarks", () => {
  const bold: TextMark[] = [{ start: 6, end: 12, fontWeight: 800 }]; // "habits" in "Track habits"
  it("insert before shifts the mark", () => expect(remapMarks("Track habits", "Track my habits", bold)).toEqual([{ start: 9, end: 15, fontWeight: 800 }]));
  it("insert after leaves it", () => expect(remapMarks("Track habits", "Track habits daily", bold)).toEqual(bold));
  it("insert inside grows it", () => expect(remapMarks("Track habits", "Track hab-its", bold)).toEqual([{ start: 6, end: 13, fontWeight: 800 }]));
  it("delete across clips it", () => expect(remapMarks("Track habits", "Trabits", bold)).toEqual([{ start: 3, end: 7, fontWeight: 800 }]));
  it("deleting the marked word drops it", () => expect(remapMarks("Track habits", "Track ", bold)).toEqual([]));
  it("pasting over the marked word drops it", () => expect(remapMarks("Track habits", "Track goal", bold)).toEqual([]));
  it("no change keeps the marks", () => expect(remapMarks("Track habits", "Track habits", bold)).toEqual(bold));
});

describe("gradients", () => {
  it("normalises stops: sorted, clamped, 2 to 8, linear angle defaulted", () => {
    expect(normalizeGradient({ kind: "linear", stops: [{ color: "#fff", at: 1.5 }, { color: "#000", at: -1 }] }))
      .toEqual({ kind: "linear", angle: 180, stops: [{ color: "#000", at: 0 }, { color: "#fff", at: 1 }] });
    expect(normalizeGradient({ kind: "linear", stops: [{ color: "#fff", at: 0 }] })).toBeUndefined();
    expect(normalizeGradient({ kind: "conic", stops: [] })).toBeUndefined();
    expect(normalizeGradient({ kind: "radial", stops: Array.from({ length: 12 }, (_, i) => ({ color: "#000", at: i / 11 })) })!.stops).toHaveLength(8);
  });
  it("becomes CSS", () => {
    expect(gradientCss(G)).toBe("linear-gradient(90deg, #ff0000 0%, #0000ff 100%)");
    expect(gradientCss({ kind: "radial", stops: G.stops })).toBe("radial-gradient(circle, #ff0000 0%, #0000ff 100%)");
  });
});
```

`packages/document/test/sp10-schema.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate, retarget } from "../src/index.ts";
import { board, doc, group, text } from "./fixtures.ts";

const deepFreeze = <T>(o: T): T => { if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const withText = (extra: Record<string, unknown>, localized?: Record<string, unknown>) => {
  const b = board("b1", [{ ...text("t", 0, 0), content: "Track habits", ...extra } as never]);
  if (localized) b.localized = localized as never;
  return doc([group([b])]);
};
const firstText = (d: ReturnType<typeof migrate>) => d.groups[0]!.boards[0]!.elements[0] as unknown as Record<string, unknown>;

describe("SP10 document fields", () => {
  it("documents saved before SP10 pass migrate unchanged", () => {
    const d = doc([group([board("b1", [text("t", 0, 0)])])]);
    expect(migrate(d)).toEqual(d);
    const dir = join(import.meta.dirname, "../../assets/templates");
    for (const f of readdirSync(dir)) {
      const once = migrate(JSON.parse(readFileSync(join(dir, f), "utf8")));
      expect(migrate(once), f).toEqual(once);
    }
  });
  it("normalises marks and gradients instead of rejecting range problems, without touching the input", () => {
    const d = deepFreeze(withText({ marks: [{ start: 6, end: 99, fontWeight: 800 }, { start: 2, end: 2, italic: true }], gradient: { kind: "linear", stops: [{ color: "#fff", at: 1 }, { color: "#000", at: 0 }] } }));
    const out = firstText(migrate(d));
    expect(out.marks).toEqual([{ start: 6, end: 12, fontWeight: 800 }]);
    expect(out.gradient).toEqual({ kind: "linear", angle: 180, stops: [{ color: "#000", at: 0 }, { color: "#fff", at: 1 }] });
    expect(firstText(migrate(withText({ marks: [{ start: 3, end: 3, italic: true }] })))).not.toHaveProperty("marks");
  });
  it("normalises a locale override's own marks against its own content", () => {
    const d = withText({}, { "de-DE": { t: { content: "Kurz", marks: [{ start: 0, end: 50, italic: true }] } } });
    expect(migrate(d).groups[0]!.boards[0]!.localized!["de-DE"]!.t!.marks).toEqual([{ start: 0, end: 4, italic: true }]);
  });
  it("rejects unsafe colours in marks and gradient stops, naming the field", () => {
    const bad = withText({ marks: [{ start: 0, end: 5, color: "red), url(http://x/)" }] });
    expect(() => migrate(bad)).toThrow(/marks/);
    expect(() => migrate(withText({ gradient: { kind: "linear", stops: [{ color: "url(x)", at: 0 }, { color: "#000", at: 1 }] } }))).toThrow();
  });
  it("validates fontFamily", () => {
    for (const bad of ['Evil"', "a;b", "a{", "<x>", "back\\slash", "x".repeat(101), "tab\there"]) {
      expect(() => migrate(withText({ fontFamily: bad })), bad).toThrow();
    }
    expect(() => migrate(withText({ fontFamily: "Pacifico (custom)" }))).not.toThrow();
  });
  it("keeps a group's styleId and rejects junk", () => {
    const d = doc([{ ...group([board("b1", [])]), styleId: "swiss-grid-bold" } as never]);
    expect(migrate(d).groups[0]!.styleId).toBe("swiss-grid-bold");
    expect(() => migrate(doc([{ ...group([board("b1", [])]), styleId: "Not Valid!" } as never]))).toThrow();
  });
  it("retargeting leaves marks untouched", () => {
    const g = migrate(withText({ marks: [{ start: 6, end: 12, fontWeight: 800 }] })).groups[0]!;
    expect((retarget(g, "iphone-6.5").boards[0]!.elements[0] as unknown as { marks: unknown }).marks).toEqual([{ start: 6, end: 12, fontWeight: 800 }]);
  });
});
```

Append to `apps/web/test/apps.test.ts`:

```ts
  it("brand font names follow the document's fontFamily rule", async () => {
    const ctx = await ctxFor("pro");
    expect(await status(createApp(ctx, { name: "F", brand: { headingFont: 'Evil"; }' } }))).toBe(400);
    expect(await status(createApp(ctx, { name: "G", brand: { headingFont: "Pacifico (custom)" } }))).toBe(200);
  });
```

Put this inside the existing `describe("apps", ...)` block.

Run: `pnpm --filter @chitrapx/document exec vitest run test/richText.test.ts test/sp10-schema.test.ts`
Expected: FAIL. The modules are missing.

- [ ] **Step 2: `gradient.ts` and `richText.ts`**

`packages/document/src/gradient.ts`:

```ts
export type GradientStop = { color: string; at: number };
/** A text fill: linear (angle in degrees, 180 = top to bottom) or radial, 2 to 8 stops, `at` in 0..1. */
export type Gradient = { kind: "linear" | "radial"; angle?: number; stops: GradientStop[] };

/** A clean gradient (sorted, clamped, 2–8 stops) or undefined when there is nothing usable. Never throws. */
export function normalizeGradient(raw: unknown): Gradient | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const g = raw as { kind?: unknown; angle?: unknown; stops?: unknown };
  if ((g.kind !== "linear" && g.kind !== "radial") || !Array.isArray(g.stops)) return undefined;
  const stops = g.stops.flatMap((s): GradientStop[] => {
    const st = s as { color?: unknown; at?: unknown } | null;
    return typeof st?.color === "string" && st.color.trim() && typeof st.at === "number" && Number.isFinite(st.at)
      ? [{ color: st.color.trim(), at: Math.min(1, Math.max(0, st.at)) }] : [];
  }).sort((a, b) => a.at - b.at).slice(0, 8);
  if (stops.length < 2) return undefined;
  if (g.kind === "radial") return { kind: "radial", stops };
  const angle = typeof g.angle === "number" && Number.isFinite(g.angle) ? ((g.angle % 360) + 360) % 360 : 180;
  return { kind: "linear", angle, stops };
}

export function gradientCss(g: Gradient): string {
  const stops = g.stops.map((s) => `${s.color} ${Math.round(s.at * 1000) / 10}%`).join(", ");
  return g.kind === "radial" ? `radial-gradient(circle, ${stops})` : `linear-gradient(${g.angle ?? 180}deg, ${stops})`;
}
```

`packages/document/src/richText.ts`:

```ts
// Mark algebra ported from PixelDeck (MIT), src/utils/richText.ts (segmentMarks, normalizeMarks,
// applyMarkStyle, clearMarkStyle, getRangeStyle), reworked for Chitrapx's mark keys; remapMarks is new.
import { normalizeGradient, type Gradient } from "./gradient.ts";

export type MarkStyle = { color?: string; gradient?: Gradient; fontWeight?: number; italic?: boolean };
/** Styling over `content[start, end)`, offsets in UTF-16 code units. Later marks win per key. */
export type TextMark = MarkStyle & { start: number; end: number };
export type StylePatch = { [K in keyof MarkStyle]?: MarkStyle[K] | null };
export const MARK_KEYS = ["color", "gradient", "fontWeight", "italic"] as const satisfies ReadonlyArray<keyof MarkStyle>;
type Range = { start: number; end: number };
type Segment = { start: number; end: number; style: MarkStyle };

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameStyle = (a: MarkStyle, b: MarkStyle) => MARK_KEYS.every((k) => sameValue(a[k], b[k]));

/** Only valid values survive, in a fixed key order. */
function cleanStyle(m: Record<string, unknown>): MarkStyle {
  const s: MarkStyle = {};
  if (typeof m.color === "string" && m.color.trim()) s.color = m.color.trim();
  const g = normalizeGradient(m.gradient);
  if (g) s.gradient = g;
  if (typeof m.fontWeight === "number" && Number.isFinite(m.fontWeight)) s.fontWeight = Math.min(1000, Math.max(1, Math.round(m.fontWeight)));
  if (typeof m.italic === "boolean") s.italic = m.italic;
  return s;
}
const canonical = (s: MarkStyle): MarkStyle => cleanStyle(s as Record<string, unknown>);

/** Colour and gradient are one fill: setting one removes the other. */
function setFill(style: MarkStyle, from: MarkStyle) {
  if (from.color !== undefined) delete style.gradient;
  if (from.gradient !== undefined) delete style.color;
  Object.assign(style, from);
}

function segmentRanges(marks: readonly TextMark[], length: number, cutsExtra: number[] = []): Segment[] {
  if (length <= 0) return [];
  const clamp = (n: number) => Math.max(0, Math.min(length, Math.floor(n)));
  const valid = marks.filter((m) => typeof m?.start === "number" && typeof m?.end === "number" && Number.isFinite(m.start) && Number.isFinite(m.end))
    .map((m) => ({ s: clamp(m.start), e: clamp(m.end), style: cleanStyle(m as unknown as Record<string, unknown>) }))
    .filter((m) => m.s < m.e && Object.keys(m.style).length);
  const cuts = [...new Set([0, length, ...valid.flatMap((m) => [m.s, m.e]), ...cutsExtra.filter((b) => b > 0 && b < length)])].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i]!, end = cuts[i + 1]!;
    const style: MarkStyle = {};
    for (const m of valid) if (m.s <= start && m.e >= end) setFill(style, m.style);
    out.push({ start, end, style: canonical(style) });
  }
  return out;
}

function toMarks(segs: Segment[]): TextMark[] {
  const out: TextMark[] = [];
  for (const seg of segs) {
    if (!Object.keys(seg.style).length) continue;
    const prev = out.at(-1);
    if (prev && prev.end === seg.start && sameStyle(prev, seg.style)) prev.end = seg.end;
    else out.push({ start: seg.start, end: seg.end, ...seg.style });
  }
  return out;
}

const lengthOf = (marks: readonly TextMark[], range?: Range) => Math.max(range?.end ?? 0, 0, ...marks.map((m) => (Number.isFinite(m.end) ? m.end : 0)));

/** Canonical marks: clamped to `length`, overlaps split (later wins), empty dropped, equal neighbours merged, sorted. */
export function normalizeMarks(marks: readonly TextMark[], length: number): TextMark[] {
  return toMarks(segmentRanges(marks, length));
}

/** Applies `style` to `range`: a value sets that key, null removes it. Returns canonical marks. */
export function applyMark(marks: readonly TextMark[], range: Range, style: StylePatch): TextMark[] {
  const length = lengthOf(marks, range);
  const s = Math.max(0, Math.floor(range.start)), e = Math.min(length, Math.floor(range.end));
  if (s >= e) return normalizeMarks(marks, length);
  const segs = segmentRanges(marks, length, [s, e]);
  for (const seg of segs) {
    if (seg.start < s || seg.end > e) continue;
    const set: MarkStyle = {};
    for (const k of MARK_KEYS) {
      const v = style[k];
      if (v === null) delete seg.style[k];
      else if (v !== undefined) (set as Record<string, unknown>)[k] = v;
    }
    setFill(seg.style, canonical(set));
    seg.style = canonical(seg.style);
  }
  return toMarks(segs);
}

/** Removes `keys` (all by default) from `range`. */
export function clearMark(marks: readonly TextMark[], range: Range, keys: readonly (keyof MarkStyle)[] = MARK_KEYS): TextMark[] {
  return applyMark(marks, range, Object.fromEntries(keys.map((k) => [k, null])) as StylePatch);
}

/** Each key's common value over `range`, or "mixed". A collapsed range reports the letter after the caret. */
export function rangeStyle(marks: readonly TextMark[], range: Range): { [K in keyof MarkStyle]: MarkStyle[K] | "mixed" | undefined } {
  const start = Math.max(0, Math.floor(range.start));
  const end = Math.max(start + (range.end > range.start ? 0 : 1), Math.floor(range.end));
  const length = lengthOf(marks, { start, end });
  const segs = segmentRanges(marks, length, [start, end]).filter((sg) => sg.start >= start && sg.end <= end);
  const out = {} as { [K in keyof MarkStyle]: MarkStyle[K] | "mixed" | undefined };
  for (const k of MARK_KEYS) {
    const values = segs.map((sg) => sg.style[k]);
    (out as Record<string, unknown>)[k] = values.every((v) => sameValue(v, values[0])) ? values[0] : "mixed";
  }
  return out;
}

/** The content cut into runs of one style, covering every letter. What the renderer draws. */
export function segments(content: string, marks: readonly TextMark[] = []): Array<Segment & { text: string }> {
  return segmentRanges(marks, content.length).map((sg) => ({ start: sg.start, end: sg.end, text: content.slice(sg.start, sg.end), style: sg.style }));
}

/** Marks carried across an edit of `oldContent` into `newContent` (see the plan's remap rules). */
export function remapMarks(oldContent: string, newContent: string, marks: readonly TextMark[] = []): TextMark[] {
  if (!marks.length) return [];
  if (oldContent === newContent) return normalizeMarks(marks, newContent.length);
  const max = Math.min(oldContent.length, newContent.length);
  let p = 0;
  while (p < max && oldContent[p] === newContent[p]) p++;
  let q = 0;
  while (q < max - p && oldContent[oldContent.length - 1 - q] === newContent[newContent.length - 1 - q]) q++;
  const oldEnd = oldContent.length - q, newEnd = newContent.length - q, delta = newContent.length - oldContent.length;
  const out: TextMark[] = [];
  for (const m of marks) {
    if (m.end <= p) out.push({ ...m });                                         // before the edit
    else if (m.start >= oldEnd) out.push({ ...m, start: m.start + delta, end: m.end + delta }); // after it
    else if (m.start < p && m.end > oldEnd) out.push({ ...m, end: m.end + delta });        // the edit is inside the mark
    else if (m.start >= p && m.end <= oldEnd) continue;                         // deleted or replaced with the edit
    else if (m.start < p) out.push({ ...m, end: p });                           // clipped on the right
    else out.push({ ...m, start: newEnd, end: m.end + delta });                 // clipped on the left
  }
  return normalizeMarks(out, newContent.length);
}
```

Add `export * from "./gradient.ts";` and `export * from "./richText.ts";` to `packages/document/src/index.ts`.

- [ ] **Step 3: Types and schema**

In `packages/document/src/artboard.ts`:
- Add `import type { Gradient } from './gradient';` and `import type { TextMark } from './richText';` at the top.
- Add to `TextElementProps` after `letterSpacing`:

```ts
  // SP10 rich text: styled ranges over `content` (start inclusive, end exclusive,
  // UTF-16 offsets). Normalised on every load and edit, never rejected for range problems.
  marks?: TextMark[];
  // SP10 whole-box gradient fill (drawn with background-clip: text).
  gradient?: Gradient;
```

- Add to `ElementLocaleOverride` after `content`:

```ts
  /** This language's own marks. Absent while `content` differs from the base: the text renders unstyled. */
  marks?: TextMark[];
```

In `packages/document/src/doc.ts`:
- Add `styleId?: string;` (comment: `/** The named style last applied (display only; values live in the elements). */`) to `BoardGroup`.
- Add `styleId: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),` to the `group` schema.
- Import `FONT_FAMILY_UNSAFE` from `./fontCatalog.ts`, `normalizeGradient` from `./gradient.ts`, and `normalizeMarks` and `type TextMark` from `./richText.ts`.
- In `cssSafe`, before the `COLOR_KEYS` branch:

```ts
      if (key === "fontFamily" && (v.length > 100 || FONT_FAMILY_UNSAFE.test(v))) { ctx.addIssue({ code: "custom", path: at, message: "Not a font family" }); continue; }
```

Add the normalisation, which runs after validation. It builds new objects: Zod copies unknown keys such as `localized` by reference, and the input may be a frozen Immer document.

```ts
type Loose = Record<string, unknown>;
function normalizeTextFields(el: Loose, content: string): Loose {
  if (!("marks" in el) && !("gradient" in el)) return el;
  const out = { ...el };
  if ("marks" in out) {
    const marks = Array.isArray(out.marks) ? normalizeMarks(out.marks as TextMark[], content.length) : [];
    if (marks.length) out.marks = marks; else delete out.marks;
  }
  if ("gradient" in out) {
    const g = normalizeGradient(out.gradient);
    if (g) out.gradient = g; else delete out.gradient;
  }
  return out;
}
const isText = (e: Loose) => e.type === "text";

/** Marks and gradients are cleaned (clamped, split, merged, sorted), never rejected for range problems. */
function normalizeRichText<T extends { groups: unknown[] }>(doc: T): T {
  for (const g of doc.groups as Array<{ boards: Loose[]; spanElements: Loose[] }>) {
    g.spanElements = g.spanElements.map((e) => (isText(e) ? normalizeTextFields(e, String(e.content ?? "")) : e));
    for (const b of g.boards) {
      const elements = (b.elements as Loose[]).map((e) => (isText(e) ? normalizeTextFields(e, String(e.content ?? "")) : e));
      b.elements = elements;
      const localized = b.localized as Record<string, Record<string, Loose>> | undefined;
      if (!localized) continue;
      const base = new Map(elements.map((e) => [e.id, e]));
      b.localized = Object.fromEntries(Object.entries(localized).map(([loc, byEl]) => [loc, Object.fromEntries(Object.entries(byEl ?? {}).map(([id, ov]) =>
        [id, ov && typeof ov === "object" ? normalizeTextFields(ov, String(ov.content ?? base.get(id)?.content ?? "")) : ov]))]));
    }
  }
  return doc;
}
```

Change the end of `docSchema` to `.superRefine((doc, ctx) => cssSafe(doc.groups, ctx, ["groups"])).transform(normalizeRichText);`.

In `apps/web/src/server/apps.ts`, change `const font = …` to:

```ts
import { FONT_FAMILY_UNSAFE } from "@chitrapx/document";
const font = z.string().trim().min(1).max(80).refine((v) => !FONT_FAMILY_UNSAFE.test(v), "Not a font name");
```

Add a row to the `NOTICES.md` table. If a PixelDeck row already exists, append this text to its "Reused material" cell instead:

```markdown
| [PixelDeck](https://github.com/Pr0xS/PixelDeck) (MIT) — SP10 | Copyright (c) 2025-2026 PixelDeck contributors | Rich text mark algebra (`packages/document/src/richText.ts`, from `src/utils/richText.ts`) and its tests; brand token resolution (`packages/document/src/brand.ts`, from `src/utils/brandColors.ts`). |
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/web exec vitest run test/apps.test.ts`
Expected: PASS, including every existing document test.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: only `billing.ts:61`.

```bash
git add packages/document apps/web/src/server/apps.ts apps/web/test/apps.test.ts NOTICES.md
git commit -m "feat(document): rich text marks and gradients with normalisation, remapping, fontFamily validation and group styleId"
```

---

### Task 10: Rich text rendering, per-language marks and the weights they need

**Files:**
- Modify: `packages/renderer/src/osg/elements/TextElement.tsx:142-239` (styles and children)
- Modify: `packages/renderer/src/osg/lib/textFit.ts:45-80` (`measureTextHeight` probe)
- Modify: `packages/renderer/src/osg/i18n/project.ts:184-192` (`isEmptyOverride`), `:298-350` (`resolveElementForLocale`)
- Modify: `packages/renderer/src/fonts.tsx` (`fontUsesOf` counts mark faces)
- Test: `packages/renderer/test/textMarks.test.tsx` (create), `packages/renderer/test/fonts.test.ts` (append), `apps/worker/test-e2e/export.test.ts` (append)
- Golden: `packages/assets/golden/rich-text-gradient.png` (create)

**Interfaces:**
- Consumes: `segments`, `gradientCss`, `TextMark`, `Gradient`, `MarkStyle` (Task 9); `fontUsesOf` (Task 4).
- Produces:
  - `TextElement` renders `<span>` runs when `marks` is non-empty. With no marks, its output is byte-identical to before.
  - A text `gradient` paints the whole box.
  - A projected element carries the locale's own `marks`. It carries none when the locale's `content` differs from the base and the locale has no marks of its own.
  - `fontUsesOf` includes every `(weight, italic)` face that marks use.

> **Ruling ("no synthetic bold"):** the stylesheet requests the real face CSS matching would choose (`matchWeight`), so a weight mark never triggers a faux bold when the family has a heavier face. CSS `font-synthesis` stays at its default. Turning it off globally would change how existing documents with bold text in single-weight families render, and with it the existing goldens.

- [ ] **Step 1: Failing tests**

`packages/renderer/test/textMarks.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArtboardState, Gradient, TextElementProps } from "@chitrapx/document";
import { TextElement } from "../src/osg/elements/TextElement";
import { projectArtboards } from "../src/osg/i18n/project";

const G: Gradient = { kind: "linear", angle: 90, stops: [{ color: "#ff0000", at: 0 }, { color: "#0000ff", at: 1 }] };
const el = (extra: Partial<TextElementProps> = {}) => ({ id: "t", type: "text", content: "Track habits", fontSize: 30, color: "#111111", fontFamily: "Inter",
  position: { x: 0, y: 0 }, size: { width: 400, height: 100 }, rotation: 0, scale: 1, ...extra }) as TextElementProps;
const html = (extra: Partial<TextElementProps> = {}) => renderToStaticMarkup(<TextElement element={el(extra)} onUpdate={() => {}} isSelected={false} artboardZoom={1} />);

describe("TextElement marks", () => {
  it("renders exactly as before when there are no marks", () => {
    expect(html()).toContain(">Track habits</div>");
    expect(html()).not.toContain("<span");
  });
  it("renders styled runs as spans and leaves the rest plain", () => {
    const h = html({ marks: [{ start: 6, end: 12, fontWeight: 800, italic: true }] });
    expect(h).toContain("<span>Track </span>");
    expect(h).toContain('<span style="font-weight:800;font-style:italic">habits</span>');
  });
  it("paints gradient runs into the glyphs, and colour runs win over a whole-box gradient", () => {
    const h = html({ gradient: G, marks: [{ start: 0, end: 5, color: "#00aa00" }, { start: 6, end: 12, gradient: G }] });
    expect(h).toContain("background-image:linear-gradient(90deg, #ff0000 0%, #0000ff 100%)");
    expect(h).toContain("background-clip:text");
    expect(h).toContain("-webkit-text-fill-color:transparent");
    expect(h).toContain('<span style="color:#00aa00;-webkit-text-fill-color:#00aa00">Track</span>');
  });
});

describe("marks per language", () => {
  const boardWith = (override: Record<string, unknown>): ArtboardState => ({
    id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1,
    elements: [el({ marks: [{ start: 6, end: 12, fontWeight: 800 }] })],
    localization: { baseLocale: "en-US", locales: [{ code: "de-DE", autoFit: false }] },
    localized: { "de-DE": { t: override } },
  } as unknown as ArtboardState);
  const projected = (override: Record<string, unknown>) => projectArtboards([boardWith(override)], "de-DE")[0]!.elements[0] as TextElementProps;

  it("a translation with its own wording and no marks renders unstyled", () => {
    expect(projected({ content: "Gewohnheiten verfolgen" }).marks).toBeUndefined();
  });
  it("a translation's own marks are used", () => {
    expect(projected({ content: "Gewohnheiten verfolgen", marks: [{ start: 0, end: 12, fontWeight: 800 }] }).marks).toEqual([{ start: 0, end: 12, fontWeight: 800 }]);
  });
  it("an override that keeps the base wording keeps the base marks", () => {
    expect(projected({ fontFamily: "Noto Sans", detached: ["fontFamily"] }).marks).toEqual([{ start: 6, end: 12, fontWeight: 800 }]);
  });
});
```

Append to `packages/renderer/test/fonts.test.ts`:

```ts
  it("requests the weights and italics that marks use, in the element's family", () => {
    const uses = fontUsesOf([board([text("Playfair Display", { content: "Keep streaks", marks: [{ start: 0, end: 4, fontWeight: 800 }, { start: 5, end: 12, italic: true }] })])]);
    expect(googleFontsHref(uses)).toBe("https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,800;1,400&display=block");
  });
```

Run: `pnpm --filter @chitrapx/renderer exec vitest run test/textMarks.test.tsx test/fonts.test.ts`
Expected: FAIL. Spans are not rendered, and mark weights are not requested.

- [ ] **Step 2: `TextElement.tsx`**

Add to the imports:

```tsx
import { gradientCss, segments, type Gradient, type MarkStyle } from '@chitrapx/document';
```

Add after `readEditedText`:

```tsx
/** A fill for a whole box or a run: a gradient is painted into the glyphs (background-clip: text). */
function fillCss(color: string | undefined, gradient: Gradient | undefined): React.CSSProperties {
  if (gradient) return { backgroundImage: gradientCss(gradient), WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent' };
  // The text-fill colour too, so a coloured run shows inside a box whose own fill is a gradient.
  if (color) return { color, WebkitTextFillColor: color };
  return {};
}
const markCss = (s: MarkStyle): React.CSSProperties => ({
  ...fillCss(s.color, s.gradient),
  ...(s.fontWeight ? { fontWeight: s.fontWeight } : {}),
  ...(s.italic !== undefined ? { fontStyle: s.italic ? 'italic' : 'normal' } : {}),
});
```

Inside the component, before `return`:

```tsx
  // Marks are drawn as runs; the browser wraps them, so the export wraps exactly like the canvas.
  const runs = element.marks?.length ? segments(element.content, element.marks) : null;
```

In the `style` object, after `color: element.color,`, add `...(element.gradient ? fillCss(undefined, element.gradient) : {}),`. Replace the children with:

```tsx
      {isEditing ? editSeed : runs ? runs.map((r) => <span key={r.start} style={markCss(r.style)}>{r.text}</span>) : element.content}
```

- [ ] **Step 3: Measuring and per-language marks**

In `packages/renderer/src/osg/lib/textFit.ts`:
- Add `'marks'` to the `Pick<…>` key list of `measureTextHeight`.
- Import `segments` from `@chitrapx/document`.
- Replace the `node.textContent = …` line with:

```ts
  // Mixed weights wrap differently, so the probe carries the same runs TextElement draws.
  const tail = content.endsWith('\n') ? [document.createTextNode('​')] : [];
  if (element.marks?.length) {
    node.replaceChildren(...segments(content, element.marks).map((r) => {
      const span = document.createElement('span');
      span.textContent = r.text;
      if (r.style.fontWeight) span.style.fontWeight = String(r.style.fontWeight);
      if (r.style.italic !== undefined) span.style.fontStyle = r.style.italic ? 'italic' : 'normal';
      return span;
    }), ...tail);
  } else {
    node.textContent = content.endsWith('\n') ? `${content}​` : content;
  }
```

In `packages/renderer/src/osg/i18n/project.ts`:
- In `isEmptyOverride`, before the final `return`, add `if (ov.marks !== undefined) return false;`.
- In `resolveElementForLocale`, after the `ALWAYS_LOCAL_KEYS` loop, add:

```ts
  // Marks are offsets into one wording. A language with its own wording either brings its own
  // marks or renders unstyled; the base marks would land on the wrong letters.
  if (el.type === 'text') {
    const baseMarks = (el as TextElementProps).marks;
    if (ov.marks !== undefined) {
      if (!sameValue(ov.marks, baseMarks)) assign('marks', ov.marks);
    } else if (baseMarks?.length && ov.content !== undefined && ov.content !== (el as TextElementProps).content) {
      assign('marks', undefined);
    }
  }
```

In `packages/renderer/src/fonts.tsx` `fontUsesOf`, replace the `add(family, …)` line with:

```ts
    const weight = parseWeight(t.fontWeight), italic = t.fontStyle === "italic";
    add(family, weight, italic);
    // Weight marks use the same family: request those faces too (the nearest one the family has).
    for (const m of t.marks ?? []) add(family, m.fontWeight ?? weight, m.italic ?? italic);
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @chitrapx/renderer test`
Expected: PASS.

- [ ] **Step 5: E2E: gradient and bold words in one headline**

Append to `apps/worker/test-e2e/export.test.ts`. This uses `singleBoardPng` from Task 8:

```ts
describe("rich text (SP10)", () => {
  it("a headline with bold words and a gradient phrase matches its golden", async () => {
    const doc = await templateDoc("amoura-dating");
    const t = doc.groups[0]!.boards[0]!.elements.find((e) => e.type === "text") as Record<string, unknown>;
    // "Track habits.\n" is 14 UTF-16 units; "Keep streaks." runs 14..27.
    Object.assign(t, { content: "Track habits.\nKeep streaks.", fontWeight: "400", fontStyle: "normal", marks: [
      { start: 0, end: 5, fontWeight: 800 },
      { start: 14, end: 27, fontWeight: 800, gradient: { kind: "linear", angle: 90, stops: [{ color: "#ff3d71", at: 0 }, { color: "#7b61ff", at: 1 }] } },
    ] });
    const { ws, appId } = await workspaceWithApp();
    compareGolden("rich-text-gradient.png", await singleBoardPng(ws, appId, migrate(doc)));
  }, 180_000);
});
```

Start the web server with the dev-server commands in Global Constraints, then run: `pnpm --filter @chitrapx/worker exec vitest run --config vitest.e2e.config.ts -t "rich text"`.
- Open `packages/assets/golden/rich-text-gradient.png`. "Track" must be heavier than "habits.", and "Keep streaks." must be bold with a pink-to-violet gradient inside the letters. A solid box or invisible text means `background-clip: text` failed.
- Then run the whole suite. Expected: PASS, other goldens unchanged.
- Stop the server by PID.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: only `billing.ts:61`.

```bash
git add packages/renderer apps/worker/test-e2e packages/assets/golden
git commit -m "feat(renderer): rich text runs with gradient fills, per-language marks and mark weights in the stylesheet"
```

---

### Task 11: Rich text editing (command, toolbar, language note)

**Files:**
- Modify: `apps/web/src/editor/commands.ts` (`setTextRich`; `updateElement` and `setOverride` remap marks)
- Create: `apps/web/src/editor/richTextModel.ts`, `apps/web/src/editor/ui/RichTextToolbar.tsx`
- Modify: `apps/web/src/editor/ui/Inspector.tsx` (text section: selection, toolbar, note)
- Test: `apps/web/test/commands.test.ts` (append), `apps/web/test/richTextModel.test.ts` (create), `apps/web/test/store.test.ts` (append)

**Interfaces:**
- Consumes: `applyMark`, `clearMark`, `rangeStyle`, `remapMarks`, `normalizeMarks`, `TextMark`, `StylePatch` (Task 9).
- Produces:
  - Command `{ type: "setTextRich"; ref: Ref; locale?: string; content: string; marks: TextMark[] }`. It writes base or locale content and normalised marks. If nothing changes, it returns the same document.
  - `updateElement` with `props.content` and no `props.marks` remaps the element's marks in the same update. `setOverride` with `props.content` remaps the override's own marks.
  - In `richTextModel.ts`:
    - `marksFor(base: TextElementProps, ov: ElementLocaleOverride | undefined, localized: boolean): TextMark[]`
    - `stylingNotCarried(base, ov): boolean`
  - `RichTextToolbar({ style, onApply, swatches? })`. `onApply(patch: StylePatch | "clear")`. `swatches` is `Array<{ label: string; value: string; hex: string }>` (Task 13 fills it).

> **Ruling (where editing happens):** the spec describes the canvas `contenteditable` showing spans. In Chitrapx the canvas is the read-only `StaticArtboard` (`pointerEvents: none`, `onUpdate` is a no-op), and text is typed in the Inspector's textarea (`Inspector.tsx`, `i-content`). So the selection comes from that textarea's `selectionStart`/`selectionEnd`, which are UTF-16 offsets just like marks. The toolbar floats above the textarea, and the canvas shows the styling live.
>
> Typing remaps marks inside each `updateElement`. The textarea's focus gesture already makes a whole edit one undo step. Applying a style ends the gesture, applies `setTextRich` as its own step, and restarts the gesture, so editing continues.

- [ ] **Step 1: Failing tests**

Append to `apps/web/test/commands.test.ts`:

```ts
import { createEditorStore } from "@/editor/store.ts";

describe("rich text commands", () => {
  const withMarks = () => applyCommand(doc(), { type: "setTextRich", ref: r("a"), content: "Track habits", marks: [{ start: 6, end: 12, fontWeight: 800 }] });
  const marksOf = (d: ChitrapxDoc, id = "a") => (findElement(d, r(id)) as { marks?: unknown }).marks;

  it("setTextRich writes content and normalised marks; the same again changes nothing", () => {
    const d = applyCommand(doc(), { type: "setTextRich", ref: r("a"), content: "Track habits", marks: [{ start: 6, end: 99, fontWeight: 800 }] });
    expect(findElement(d, r("a"))).toMatchObject({ content: "Track habits", marks: [{ start: 6, end: 12, fontWeight: 800 }] });
    expect(applyCommand(d, { type: "setTextRich", ref: r("a"), content: "Track habits", marks: [{ start: 6, end: 12, fontWeight: 800 }] })).toBe(d);
  });

  it("setTextRich in a language writes that language's own content and marks only", () => {
    const d = applyCommand(withMarks(), { type: "setTextRich", ref: r("a"), locale: "de-DE", content: "Gewohnheiten", marks: [{ start: 0, end: 5, italic: true }] });
    expect(d.groups[0]!.boards[0]!.localized!["de-DE"]!.a).toMatchObject({ content: "Gewohnheiten", marks: [{ start: 0, end: 5, italic: true }], origin: "manual" });
    expect(marksOf(d)).toEqual([{ start: 6, end: 12, fontWeight: 800 }]);
  });

  it("typing keeps the styling on the same words (updateElement remaps marks)", () => {
    const shifted = applyCommand(withMarks(), { type: "updateElement", ref: r("a"), props: { content: "Track my habits" } as never });
    expect(marksOf(shifted)).toEqual([{ start: 9, end: 15, fontWeight: 800 }]);
    const inside = applyCommand(withMarks(), { type: "updateElement", ref: r("a"), props: { content: "Track hab-its" } as never });
    expect(marksOf(inside)).toEqual([{ start: 6, end: 13, fontWeight: 800 }]);
    const gone = applyCommand(withMarks(), { type: "updateElement", ref: r("a"), props: { content: "Track " } as never });
    expect(findElement(gone, r("a"))).not.toHaveProperty("marks");
  });

  it("typing in a language remaps that language's marks", () => {
    let d = applyCommand(withMarks(), { type: "setTextRich", ref: r("a"), locale: "de-DE", content: "Gewohnheiten", marks: [{ start: 0, end: 12, italic: true }] });
    d = applyCommand(d, { type: "setOverride", ref: r("a"), locale: "de-DE", props: { content: "Neue Gewohnheiten" } });
    expect(d.groups[0]!.boards[0]!.localized!["de-DE"]!.a!.marks).toEqual([{ start: 5, end: 17, italic: true }]);
  });

  it("applying a style is one undo step", () => {
    const store = createEditorStore({ projectId: "p", doc: withMarks(), revision: 0 });
    store.getState().apply({ type: "setTextRich", ref: r("a"), content: "Track habits", marks: [{ start: 0, end: 5, italic: true }] });
    store.getState().undo();
    expect(marksOf(store.getState().doc)).toEqual([{ start: 6, end: 12, fontWeight: 800 }]);
  });
});
```

Make sure `ChitrapxDoc` is imported in that file. It already is.

`apps/web/test/richTextModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TextElementProps } from "@chitrapx/document";
import { marksFor, stylingNotCarried } from "@/editor/richTextModel.ts";

const base = { content: "Track habits", marks: [{ start: 6, end: 12, fontWeight: 800 }] } as TextElementProps;

describe("rich text in languages", () => {
  it("edits the base marks in the base language", () => expect(marksFor(base, undefined, false)).toEqual(base.marks));
  it("a language without its own wording shows the base marks", () => expect(marksFor(base, { fontFamily: "Noto Sans" }, true)).toEqual(base.marks));
  it("a language with its own wording uses its own marks, or none", () => {
    expect(marksFor(base, { content: "Gewohnheiten" }, true)).toEqual([]);
    expect(marksFor(base, { content: "Gewohnheiten", marks: [{ start: 0, end: 4, italic: true }] }, true)).toEqual([{ start: 0, end: 4, italic: true }]);
  });
  it("says so when styling did not carry over", () => {
    expect(stylingNotCarried(base, { content: "Gewohnheiten" })).toBe(true);
    expect(stylingNotCarried(base, { content: "Track habits" })).toBe(false);
    expect(stylingNotCarried(base, { content: "Gewohnheiten", marks: [{ start: 0, end: 4, italic: true }] })).toBe(false);
    expect(stylingNotCarried({ content: "Plain" } as TextElementProps, { content: "Einfach" })).toBe(false);
  });
});
```

Run: `pnpm --filter @chitrapx/web exec vitest run test/commands.test.ts test/richTextModel.test.ts`
Expected: FAIL. `setTextRich` is unknown and the module is missing.

- [ ] **Step 2: Commands**

In `apps/web/src/editor/commands.ts`:
- Import `normalizeMarks`, `remapMarks` and `type TextMark` from `@chitrapx/document`.
- Add `| { type: "setTextRich"; ref: Ref; locale?: string; content: string; marks: TextMark[] }` to `Command`.
- Replace the `updateElement` case:

```ts
      case "updateElement": {
        const el = list(d, cmd.ref.groupId, cmd.ref.boardId)?.find((e) => e.id === cmd.ref.elementId);
        if (!el) return;
        const t = el as unknown as Record<string, unknown>;
        const props = cmd.props as Record<string, unknown>;
        // A content edit carries the element's marks with it, in the same undo step.
        const remap = t.type === "text" && typeof props.content === "string" && !("marks" in props) && Array.isArray(t.marks) && t.marks.length;
        const marks = remap ? remapMarks(String(t.content ?? ""), props.content as string, t.marks as TextMark[]) : null;
        Object.assign(el, cmd.props);
        if (marks) { if (marks.length) t.marks = marks; else delete t.marks; }
        return;
      }
```

In the `setOverride` / `resetOverride` case, replace the `if (cmd.type === "setOverride") { … }` block:

```ts
        if (cmd.type === "setOverride") {
          const baseContent = (b.elements.find((e) => e.id === cmd.ref.elementId) as { content?: string } | undefined)?.content ?? "";
          const before = typeof current.content === "string" ? current.content : baseContent;
          Object.assign(current, cmd.props);
          // A person typed this: machine translation must never overwrite it.
          if ("content" in cmd.props && !("origin" in cmd.props)) current.origin = "manual";
          if ("content" in cmd.props && !("marks" in cmd.props) && Array.isArray(current.marks)) {
            const m = remapMarks(before, String(current.content ?? ""), current.marks as TextMark[]);
            if (m.length) current.marks = m; else delete current.marks;
          }
        }
```

Add the new case:

```ts
      case "setTextRich": {
        const marks = normalizeMarks(cmd.marks, cmd.content.length);
        const same = (a: unknown) => JSON.stringify(a ?? []) === JSON.stringify(marks);
        if (cmd.locale && cmd.ref.boardId) {
          const b = findBoard(d, cmd.ref.groupId, cmd.ref.boardId);
          if (!b || b.elements.find((e) => e.id === cmd.ref.elementId)?.type !== "text") return;
          const existing = b.localized?.[cmd.locale]?.[cmd.ref.elementId] as Record<string, unknown> | undefined;
          if (existing?.content === cmd.content && same(existing.marks)) return; // nothing to do: no undo step
          const ov = (((b.localized ??= {})[cmd.locale] ??= {})[cmd.ref.elementId] ??= {}) as Record<string, unknown>;
          if (ov.content !== cmd.content) { ov.content = cmd.content; ov.origin = "manual"; }
          if (marks.length) { if (!same(ov.marks)) ov.marks = marks; } else delete ov.marks;
          return;
        }
        const el = list(d, cmd.ref.groupId, cmd.ref.boardId)?.find((e) => e.id === cmd.ref.elementId) as unknown as Record<string, unknown> | undefined;
        if (!el || el.type !== "text") return;
        if (el.content !== cmd.content) el.content = cmd.content;
        if (marks.length) { if (!same(el.marks)) el.marks = marks; } else if (el.marks) delete el.marks;
        return;
      }
```

- [ ] **Step 3: Model and toolbar**

`apps/web/src/editor/richTextModel.ts`:

```ts
import type { ElementLocaleOverride, TextElementProps, TextMark } from "@chitrapx/document";

const ownWording = (base: TextElementProps, ov?: ElementLocaleOverride) => ov?.content !== undefined && ov.content !== base.content;

/** The marks the inspector edits: the base ones, or in a language view that language's own (none if it reworded without any). */
export function marksFor(base: TextElementProps, ov: ElementLocaleOverride | undefined, localized: boolean): TextMark[] {
  if (!localized) return base.marks ?? [];
  if (ov?.marks) return ov.marks;
  return ownWording(base, ov) ? [] : base.marks ?? [];
}

/** True when the base text is styled but this language reworded it without styling of its own. */
export const stylingNotCarried = (base: TextElementProps, ov?: ElementLocaleOverride) =>
  !!base.marks?.length && ownWording(base, ov) && !ov?.marks?.length;
```

`apps/web/src/editor/ui/RichTextToolbar.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { MarkStyle, StylePatch } from "@chitrapx/document";

type RangeStyle = { [K in keyof MarkStyle]: MarkStyle[K] | "mixed" | undefined };
const WEIGHTS = [300, 400, 500, 600, 700, 800, 900] as const;
/** Keeps the textarea's focus and selection while a toolbar button is pressed. */
const keep = (e: React.MouseEvent) => e.preventDefault();

/** Styles the selected words: colour (with brand swatches), gradient, weight, italic, clear. Each press is one undo step. */
export function RichTextToolbar({ style, onApply, swatches = [] }: {
  style: RangeStyle; onApply: (patch: StylePatch | "clear") => void; swatches?: Array<{ label: string; value: string; hex: string }>;
}) {
  const [from, setFrom] = useState("#ff3d71");
  const [to, setTo] = useState("#7b61ff");
  const [angle, setAngle] = useState(90);
  const color = typeof style.color === "string" && /^#[0-9a-f]{6}$/i.test(style.color) ? style.color : "#000000";
  return (
    <div role="toolbar" aria-label="Style the selected words" className="flex flex-wrap items-center gap-1 rounded-md border border-neutral-200 bg-white p-1 shadow dark:border-neutral-700 dark:bg-neutral-900">
      <input type="color" aria-label="Colour of the selected words" value={color} onChange={(e) => onApply({ color: e.target.value })} className="h-7 w-8" />
      {swatches.map((s) => (
        <button key={s.value} type="button" onMouseDown={keep} onClick={() => onApply({ color: s.value })} title={`Brand ${s.label}`} aria-label={`Brand ${s.label}`}
          className="h-6 w-6 rounded border border-neutral-300" style={{ background: s.hex }} />
      ))}
      <select aria-label="Weight of the selected words" className="input h-7 w-24 py-0" value={typeof style.fontWeight === "number" ? String(style.fontWeight) : ""}
        onChange={(e) => onApply({ fontWeight: Number(e.target.value) })}>
        <option value="" disabled>{style.fontWeight === "mixed" ? "Mixed" : "Weight"}</option>
        {WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
      </select>
      <button type="button" onMouseDown={keep} aria-pressed={style.italic === true} className={style.italic === true ? "btn px-2" : "btn-ghost px-2"}
        onClick={() => onApply({ italic: style.italic !== true })}><em>I</em></button>
      <span className="flex items-center gap-1">
        <input type="color" aria-label="Gradient start" value={from} onChange={(e) => setFrom(e.target.value)} className="h-7 w-7" />
        <input type="color" aria-label="Gradient end" value={to} onChange={(e) => setTo(e.target.value)} className="h-7 w-7" />
        <input type="number" aria-label="Gradient angle" value={angle} min={0} max={359} onChange={(e) => setAngle(Number(e.target.value) || 0)} className="input h-7 w-14 py-0" />
        <button type="button" onMouseDown={keep} className="btn-ghost px-2"
          onClick={() => onApply({ gradient: { kind: "linear", angle, stops: [{ color: from, at: 0 }, { color: to, at: 1 }] } })}>Gradient</button>
      </span>
      <button type="button" onMouseDown={keep} className="btn-ghost px-2" onClick={() => onApply("clear")}>Clear</button>
    </div>
  );
}
```

- [ ] **Step 4: Inspector**

In `ElementInspector`'s text section:
- Import `applyMark`, `clearMark` and `rangeStyle` from `@chitrapx/document`, `marksFor` and `stylingNotCarried` from `../richTextModel.ts`, and `RichTextToolbar`.
- Add the state and handler:

```tsx
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const textBase = el as TextElementProps;
  const textValue = override?.content ?? a.content ?? "";
  const currentMarks = el.type === "text" ? marksFor(textBase, override, localized) : [];
  const applyRich = (patch: StylePatch | "clear") => {
    if (!sel) return;
    const next = patch === "clear" ? clearMark(currentMarks, sel) : applyMark(currentMarks, sel, patch);
    const s = store.getState();
    const typing = document.activeElement === content.current;
    s.endGesture(); // the typing so far is its own undo step…
    s.apply({ type: "setTextRich", ref: refr, locale: localized ? locale : undefined, content: textValue, marks: next }); // …and so is this
    if (typing) s.beginGesture();
    const keepSel = sel;
    requestAnimationFrame(() => content.current?.setSelectionRange(keepSel.start, keepSel.end));
  };
```

Wrap the `i-content` textarea row as below, keeping the existing `onChange` and gesture handlers:

```tsx
          <Row label="Text" htmlFor="i-content">
            <div className="relative">
              {sel && (
                <div className="absolute bottom-full left-0 z-20 mb-1">
                  <RichTextToolbar style={rangeStyle(currentMarks, sel)} onApply={applyRich} />
                </div>
              )}
              <textarea id="i-content" ref={content} className="input min-h-20" value={textValue} onChange={(e) => setLocalizable("content", e.target.value)}
                onSelect={(e) => { const t = e.currentTarget; setSel(t.selectionEnd > t.selectionStart ? { start: t.selectionStart, end: t.selectionEnd } : null); }}
                {...g} />
            </div>
            {localized && stylingNotCarried(textBase, override) && <p className="text-xs text-amber-700 dark:text-amber-300">Styling not carried to this language — reapply</p>}
            <OverrideNote k="content" />
          </Row>
```

`StylePatch` is a type import from `@chitrapx/document`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @chitrapx/web exec vitest run test/commands.test.ts test/richTextModel.test.ts test/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Browser check**

Start the web dev server with the dev-server commands in Global Constraints.
- Select "Keep streaks." in a headline's text field. Set weight 800, then Gradient: the canvas shows it. Undo once: only the gradient goes. Undo again: the weight goes.
- Type a word before it: the styling stays on "Keep streaks.".
- Switch to a second language and type different words: "Styling not carried to this language — reapply" appears. Select a word and apply italic: the note goes.

Stop the server by PID.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: only `billing.ts:61`.

```bash
git add apps/web
git commit -m "feat(editor): style selected words (colour, gradient, weight, italic) as one undo step; marks follow typing and languages"
```

---

### Task 12: Brand tokens: palette data and one resolution point

**Files:**
- Create: `packages/document/src/brand.ts`, `packages/document/test/brand.test.ts`
- Modify: `packages/document/src/doc.ts:33` (`COLOR` accepts `brand:<token>`), `packages/document/src/readiness.ts` (`brand_token_unset`), `packages/document/src/index.ts`
- Modify: `packages/db/src/schema.ts:33-39` (`Brand.palette`)
- Modify: `apps/web/src/server/apps.ts` (`brandSchema.palette`)
- Modify: `packages/renderer/src/board.ts` (`boardFor` options), `packages/renderer/src/extras.ts` (`palette`), `packages/renderer/src/BoardView.tsx`, `packages/renderer/src/VideoFrame.tsx`, `apps/web/src/components/RenderSheet.tsx`
- Modify: `apps/web/src/server/renderExtras.ts` (palette from the app), `apps/web/src/app/editor/[projectId]/page.tsx`, `apps/web/src/app/render/[jobId]/page.tsx`, `apps/web/src/app/dashboard/projects/[projectId]/page.tsx`, `.../preview/page.tsx`, `apps/web/src/editor/ui/Checks.tsx`, `apps/web/src/editor/ui/Toolbar.tsx`
- Test: `packages/document/test/sp10-schema.test.ts` (append), `packages/document/test/readiness.test.ts` (append), `packages/renderer/test/hidden.test.ts` (append), `apps/web/test/apps.test.ts` (append)

**Interfaces:**
- Consumes: `RenderExtras`, `renderExtras` (Task 7), `contentChecks` (Task 8).
- Produces (from `@chitrapx/document`):
  - `BRAND_TOKENS`, `type BrandToken = "primary" | "secondary" | "accent" | "surface" | "text" | "muted"`, `type BrandPalette = Partial<Record<BrandToken, string>>`
  - `isBrandToken(v): v is string`, `parseBrandToken(v): BrandToken | null`, `toBrandToken(t): string`
  - `brandPalette(brand): BrandPalette`. It seeds `primary`/`secondary` from `primaryColor`/`secondaryColor` when no `palette` is saved.
  - `resolveBrand<T>(value: T, palette: BrandPalette | undefined): T`. It replaces tokens with hex anywhere in `value`. An unresolved field is dropped, and a gradient (stops, or `color1`/`color2`) with an unresolved colour is dropped whole. It returns `value` itself when there is no token.
  - `docBrandTokens(doc: unknown): BrandToken[]`
  - `ContentContext` gains `palette?: BrandPalette`, and `contentChecks` emits `brand_token_unset`.
- Produces (elsewhere):
  - `boardFor(doc, groupId, boardIndex, locale, resolveSrc, opts?: { palette?: BrandPalette })`
  - `RenderExtras.palette?: BrandPalette`
  - `renderExtras(ctx, storage, { doc?, appId? })` fills `palette` when `appId` is given.
  - `Brand.palette?: Array<{ token: BrandToken; color: string }>`

- [ ] **Step 1: Failing tests**

`packages/document/test/brand.test.ts` adapts PixelDeck's `brandColors.test.ts` (MIT):

```ts
import { describe, expect, it } from "vitest";
import { brandPalette, docBrandTokens, isBrandToken, parseBrandToken, resolveBrand, toBrandToken } from "../src/index.ts";

const palette = { primary: "#4f46e5", accent: "#f59e0b" };

describe("brand tokens", () => {
  it("parses only the six tokens", () => {
    expect(isBrandToken("brand:primary")).toBe(true);
    expect(isBrandToken("brand:pink")).toBe(false);
    expect(parseBrandToken("brand:muted")).toBe("muted");
    expect(toBrandToken("surface")).toBe("brand:surface");
  });
  it("seeds primary and secondary from the old fields when no palette is saved", () => {
    expect(brandPalette({ primaryColor: "#111111", secondaryColor: "#222222" })).toEqual({ primary: "#111111", secondary: "#222222" });
    expect(brandPalette({ primaryColor: "#111111", palette: [{ token: "accent", color: "#333333" }] })).toEqual({ accent: "#333333" });
    expect(brandPalette(undefined)).toEqual({});
  });
  it("resolves tokens in colours, gradient stops and marks", () => {
    const el = { color: "brand:primary", gradient: { kind: "linear", stops: [{ color: "brand:accent", at: 0 }, { color: "#fff", at: 1 }] }, marks: [{ start: 0, end: 2, color: "brand:accent" }] };
    expect(resolveBrand(el, palette)).toEqual({ color: "#4f46e5", gradient: { kind: "linear", stops: [{ color: "#f59e0b", at: 0 }, { color: "#fff", at: 1 }] }, marks: [{ start: 0, end: 2, color: "#f59e0b" }] });
  });
  it("drops what it cannot resolve, so the element default applies; a gradient goes whole", () => {
    const el = { color: "brand:text", fillColor: "brand:primary", gradient: { kind: "linear", stops: [{ color: "brand:muted", at: 0 }, { color: "#fff", at: 1 }] }, marks: [{ start: 0, end: 2, color: "brand:surface", fontWeight: 700 }] };
    const out = resolveBrand(el, palette);
    expect(out).toEqual({ fillColor: "#4f46e5", marks: [{ start: 0, end: 2, fontWeight: 700 }] });
    expect(JSON.stringify(resolveBrand(el, undefined))).not.toContain("brand:");
    expect(resolveBrand({ backgroundType: "gradient", backgroundGradient: { color1: "brand:accent", color2: "brand:secondary", angle: 90 } }, palette)).toEqual({ backgroundType: "gradient" });
  });
  it("returns the same value when there is no token", () => {
    const plain = { color: "#000", marks: [] };
    expect(resolveBrand(plain, palette)).toBe(plain);
  });
  it("lists the tokens a document uses", () => {
    expect(docBrandTokens({ a: "brand:primary", b: [{ c: "brand:muted" }, "brand:primary"], d: "#fff" }).sort()).toEqual(["muted", "primary"]);
  });
});
```

Append to `packages/document/test/sp10-schema.test.ts`:

```ts
  it("accepts brand tokens wherever a colour goes, and nothing else after brand:", () => {
    expect(() => migrate(withText({ color: "brand:text", marks: [{ start: 0, end: 5, color: "brand:accent" }] }))).not.toThrow();
    expect(() => migrate(withText({ color: "brand:pink" }))).toThrow();
    expect(() => migrate(withText({ color: "brand:primary; background:url(x)" }))).toThrow();
  });
```

Append to `packages/document/test/readiness.test.ts`:

```ts
describe("contentChecks: brand colours", () => {
  it("warns about each token the palette lacks", () => {
    const d = doc([group([board("b1", [{ ...text("t", 0, 0), color: "brand:accent" } as never]), board("b2", [{ ...text("u", 0, 0), color: "brand:primary" } as never])])]);
    expect(contentChecks(d, { customFamilies: [], palette: { primary: "#111111" } })).toEqual([
      { severity: "warning", code: "brand_token_unset", message: "Brand colour accent not set", groupId: "g1", boardIndex: 0 },
    ]);
  });
});
```

Append to `packages/renderer/test/hidden.test.ts`:

```ts
describe("brand tokens in boardFor", () => {
  it("resolve once for every render surface; unknown tokens never reach the renderer", () => {
    const doc = {
      schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [] },
      groups: [{ id: "g", target: "iphone-6.9", spanElements: [],
        boards: [{ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "brand:surface", zoom: 1,
          elements: [el("a", { fillColor: "brand:primary" }), el("c", { fillColor: "brand:accent" })] }] }],
    } as unknown as ChitrapxDoc;
    const { board } = boardFor(doc, "g", 0, null, (s) => s, { palette: { primary: "#4f46e5", surface: "#fafafa" } });
    expect(board.backgroundColor).toBe("#fafafa");
    expect((board.elements[0] as unknown as { fillColor: string }).fillColor).toBe("#4f46e5");
    expect(board.elements[1]).not.toHaveProperty("fillColor");
    expect(JSON.stringify(boardFor(doc, "g", 0, null, (s) => s).board)).not.toContain("brand:");
  });
});
```

Append to `apps/web/test/apps.test.ts`, inside `describe("apps")`:

```ts
  it("validates the palette: hex only, known tokens, each once, at most six", async () => {
    const ctx = await ctxFor("pro");
    const app = await createApp(ctx, { name: "P" });
    const ok = [{ token: "primary", color: "#112233" }, { token: "accent", color: "#445566" }];
    expect((await updateApp(ctx, app.id, { brand: { palette: ok } })).brand.palette).toEqual(ok);
    expect(await status(updateApp(ctx, app.id, { brand: { palette: [{ token: "primary", color: "red" }] } }))).toBe(400);
    expect(await status(updateApp(ctx, app.id, { brand: { palette: [{ token: "pink", color: "#112233" }] } }))).toBe(400);
    expect(await status(updateApp(ctx, app.id, { brand: { palette: [{ token: "text", color: "#111111" }, { token: "text", color: "#222222" }] } }))).toBe(400);
  });
```

Run: `pnpm --filter @chitrapx/document exec vitest run test/brand.test.ts`
Expected: FAIL. `brand.ts` is missing.

- [ ] **Step 2: `brand.ts` and the colour rule**

`packages/document/src/brand.ts`:

```ts
// Token resolution ported from PixelDeck (MIT), src/utils/brandColors.ts (isBrandToken, parseBrandToken,
// resolveBrandColor, resolveFill), extended to every colour field, gradient stops and rich text marks.
export const BRAND_TOKENS = ["primary", "secondary", "accent", "surface", "text", "muted"] as const;
export type BrandToken = (typeof BRAND_TOKENS)[number];
export type BrandPalette = Partial<Record<BrandToken, string>>;

const TOKEN = /^brand:(primary|secondary|accent|surface|text|muted)$/;
export const isBrandToken = (v: unknown): v is string => typeof v === "string" && TOKEN.test(v);
export const parseBrandToken = (v: string): BrandToken | null => (TOKEN.exec(v)?.[1] as BrandToken | undefined) ?? null;
export const toBrandToken = (t: BrandToken) => `brand:${t}`;

/** The app's palette by token; primaryColor/secondaryColor fill those two slots until a palette is saved. */
export function brandPalette(brand: { palette?: Array<{ token: BrandToken; color: string }>; primaryColor?: string; secondaryColor?: string } | null | undefined): BrandPalette {
  if (!brand) return {};
  if (brand.palette?.length) return Object.fromEntries(brand.palette.map((p) => [p.token, p.color])) as BrandPalette;
  return { ...(brand.primaryColor ? { primary: brand.primaryColor } : {}), ...(brand.secondaryColor ? { secondary: brand.secondaryColor } : {}) };
}

const DROP = Symbol("unresolved brand colour");
const isFill = (o: object) => "stops" in o || "color1" in o || "color2" in o || ("at" in o && "color" in o);

function walk(v: unknown, palette: BrandPalette, key: string): unknown {
  if (typeof v === "string") {
    const t = parseBrandToken(v);
    return t ? (palette[t] ?? DROP) : v;
  }
  if (Array.isArray(v)) {
    const out = v.map((x) => walk(x, palette, key));
    if (!out.includes(DROP)) return out;
    return key === "stops" ? DROP : out.filter((x) => x !== DROP);
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    let dropped = false;
    for (const [k, x] of Object.entries(v)) {
      const r = walk(x, palette, k);
      if (r === DROP) { dropped = true; continue; }
      out[k] = r;
    }
    // A gradient (or one of its stops) missing a colour is dropped whole: half a gradient is not a design.
    return dropped && isFill(v) ? DROP : out;
  }
  return v;
}

/**
 * Replaces brand:<token> with the palette colour anywhere in `value`. A token the palette lacks
 * drops its field (so the element default applies); a gradient with such a stop is dropped whole.
 * Returns `value` itself when it holds no token.
 */
export function resolveBrand<T>(value: T, palette: BrandPalette | undefined): T {
  if (!JSON.stringify(value)?.includes('"brand:')) return value;
  const out = walk(value, palette ?? {}, "");
  return (out === DROP ? undefined : out) as T;
}

/** Every token a document uses. */
export function docBrandTokens(doc: unknown): BrandToken[] {
  const found = new Set<BrandToken>();
  JSON.stringify(doc, (_k, v) => { if (typeof v === "string") { const t = parseBrandToken(v); if (t) found.add(t); } return v; });
  return [...found];
}
```

Add `export * from "./brand.ts";` to `packages/document/src/index.ts`.

In `packages/document/src/doc.ts`, change `COLOR` to accept a brand token as one more alternative:

```ts
const COLOR = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9\s.,%/+-]+\)|[a-zA-Z]{3,30}|brand:(primary|secondary|accent|surface|text|muted))$/;
```

In `packages/document/src/readiness.ts`:
- Import `docBrandTokens` and `type BrandPalette` from `./brand.ts`.
- Change `ContentContext` to `{ customFamilies: readonly string[]; palette?: BrandPalette }`.
- Inside `contentChecks`'s `perBoard` loop, after the font check, add:

```ts
      for (const token of docBrandTokens(part)) {
        const key = `brand:${token}`;
        if (reported.has(key) || ctx.palette?.[token]) continue;
        reported.add(key);
        out.push({ severity: "warning", code: "brand_token_unset", message: `Brand colour ${token} not set`, groupId: g.id, boardIndex });
      }
```

- [ ] **Step 3: Palette on the app**

In `packages/db/src/schema.ts`, import `type { BrandToken } from "@chitrapx/document"` and add `palette?: Array<{ token: BrandToken; color: string }>;` to `Brand`.

In `apps/web/src/server/apps.ts`:

```ts
import { BRAND_TOKENS, FONT_FAMILY_UNSAFE } from "@chitrapx/document";

const palette = z.array(z.object({ token: z.enum(BRAND_TOKENS), color: hex }).strict()).max(6)
  .refine((p) => new Set(p.map((x) => x.token)).size === p.length, "Each brand colour can appear once");

// in brandSchema:
  palette: palette.optional(),
```

- [ ] **Step 4: One resolution point in the renderer**

In `packages/renderer/src/board.ts`:

```ts
import { resolveBrand, type ArtboardState, type BrandPalette, type ChitrapxDoc } from "@chitrapx/document";

export function boardFor(doc: ChitrapxDoc, groupId: string, boardIndex: number, locale: string | null, resolveSrc: ResolveSrc,
  opts: { palette?: BrandPalette } = {}): { board: ArtboardState; missing: string[] } {
  // ...unchanged down to `elements`...
  // SP10: brand tokens resolve here, once, so canvas, preview, export and video agree.
  const branded = resolveBrand({ ...board, elements }, opts.palette);
  return { board: resolveBoardSources(branded, resolveSrc, missing), missing: [...missing] };
}
```

- In `packages/renderer/src/extras.ts`, import `type BrandPalette` and add `palette?: BrandPalette` to `RenderExtras`.
- In `BoardView.tsx`, call `boardFor(doc, groupId, boardIndex, locale, resolveSrc, { palette: extras?.palette })` and add `extras?.palette` to the `useMemo` deps.
- In `VideoFrame.tsx`, pass `{ palette: extras?.palette }` to `boardFor` the same way.
- In `RenderSheet.tsx`, pass `{ palette: extras?.palette }` to `boardFor`.

In `apps/web/src/server/renderExtras.ts`:

```ts
import { brandPalette, docFontFamilies, type ChitrapxDoc } from "@chitrapx/document";
import { getApp } from "./apps.ts";

export async function renderExtras(ctx: Ctx, storage: ObjectStorage, opts: { doc?: ChitrapxDoc; appId?: string } = {}): Promise<RenderExtras> {
  const [fonts, app] = await Promise.all([listFonts(ctx, storage), opts.appId ? getApp(ctx, opts.appId) : null]);
  return { faces: facesOf(fonts, opts.doc ? new Set(docFontFamilies(opts.doc)) : undefined), palette: brandPalette(app?.brand) };
}
```

Pass `appId` at every call site:
- Editor page: `extras={{ faces: facesOf(fonts), palette: brandPalette((await getApp(ctx, project.appId)).brand) }}`.
- Render page: for the export path, read `const [p] = await db.select({ appId: schema.projects.appId }).from(schema.projects).where(and(eq(schema.projects.id, job.projectId), eq(schema.projects.workspaceId, job.workspaceId)));` and pass `appId: p?.appId`. For the video path, pass `appId: project.appId`.
- Dashboard project page and preview page: pass `appId: project.appId`.

In `Checks.tsx` and `Toolbar.tsx`, pass `palette: extras.palette` in the `contentChecks` context, taking `extras` from `useEditorAssets()`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/renderer test && pnpm --filter @chitrapx/web exec vitest run test/apps.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: only `billing.ts:61`.

```bash
git add packages apps/web
git commit -m "feat(brand): six-token brand palette, brand:<token> colours resolved once in boardFor, unset-token check"
```

---

### Task 13: Palette grid, extraction from screenshots, brand swatches

**Files:**
- Create: `apps/web/src/lib/colorExtract.ts`, `apps/web/src/components/PaletteGrid.tsx`
- Modify: `apps/web/src/components/BrandForm.tsx`, `apps/web/src/app/dashboard/apps/[appId]/page.tsx` (screenshot URLs for extraction)
- Modify: `apps/web/src/editor/ui/fields.tsx` (`ColorField` brand swatch row), `apps/web/src/editor/ui/Inspector.tsx` (toolbar swatches)
- Test: `apps/web/test/colorExtract.test.ts` (create)

**Interfaces:**
- Consumes: `BRAND_TOKENS`, `brandPalette`, `contrastRatio`, `toBrandToken`, `parseBrandToken` (Task 12 and `aso.ts`); `RichTextToolbar.swatches` (Task 11); `useEditorAssets().extras.palette` (Task 12).
- Produces:
  - `paletteFromPixels(images: Array<{ data: Uint8ClampedArray | Uint8Array }>, max = 6): string[]`. It is pure and deterministic and returns lowercase hex.
  - `extractPalette(urls: string[]): Promise<string[]>` (DOM: canvas at 64 px max side)
  - `PaletteGrid({ value, onChange, saved })`, where `value` and `saved` are `BrandPalette`
  - `brandSwatches(palette): Array<{ label: BrandToken; value: string; hex: string }>` in `fields.tsx`. `ColorField` shows them when the editor palette has any colours.

- [ ] **Step 1: Failing tests**

`apps/web/test/colorExtract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { paletteFromPixels } from "@/lib/colorExtract.ts";

/** An RGBA image made of [r, g, b, count] runs. */
const image = (runs: Array<[number, number, number, number]>) => {
  const total = runs.reduce((n, [, , , c]) => n + c, 0);
  const data = new Uint8ClampedArray(total * 4);
  let i = 0;
  for (const [r, g, b, c] of runs) for (let k = 0; k < c; k++) { data.set([r, g, b, 255], i); i += 4; }
  return { data };
};

describe("paletteFromPixels", () => {
  const shots = [
    image([[224, 48, 48, 500], [255, 255, 255, 900], [10, 10, 10, 400], [128, 128, 128, 300], [40, 90, 220, 300]]),
    image([[40, 90, 220, 100], [30, 160, 90, 250], [228, 51, 51, 20]]),
  ];
  it("ranks colourful buckets by frequency, skipping white, black and grey", () => {
    expect(paletteFromPixels(shots)).toEqual(["#e03030", "#285adc", "#1ea05a"]);
  });
  it("is deterministic", () => {
    expect(paletteFromPixels(shots)).toEqual(paletteFromPixels(shots));
  });
  it("merges near-identical shades into one swatch", () => {
    expect(paletteFromPixels([image([[224, 48, 48, 100], [230, 52, 52, 90]])])).toHaveLength(1);
  });
  it("finds nothing in greyscale screenshots", () => {
    expect(paletteFromPixels([image([[255, 255, 255, 100], [0, 0, 0, 100], [120, 120, 120, 100], [200, 205, 200, 50]])])).toEqual([]);
  });
  it("returns at most six", () => {
    const many = image(Array.from({ length: 10 }, (_, i) => [i * 25, 255 - i * 25, (i * 80) % 256, 10 + i] as [number, number, number, number]));
    expect(paletteFromPixels([many]).length).toBeLessThanOrEqual(6);
  });
});
```

The expected hexes are bucket averages, and these values were checked by running the Step 2 code:
- `224/48/48` and `228/51/51` share one 32-level bucket (`>>3` gives 28, 6, 6). Their average, weighted 500:20, rounds to `#e03030`.
- `40/90/220` gives `#285adc`, and `30/160/90` gives `#1ea05a`.
- The 0–255 white and black runs, and the grey `128/128/128`, are skipped.

Run: `pnpm --filter @chitrapx/web exec vitest run test/colorExtract.test.ts`
Expected: FAIL. The module is missing.

- [ ] **Step 2: `colorExtract.ts`**

The code is our own. It follows storeshots' approach (bucket, skip greys, rank) in ideas only, with no code copied.

```ts
/** Downscaled screenshot pixels → up to `max` dominant colours. Pure and deterministic; no network. */
export function paletteFromPixels(images: Array<{ data: Uint8ClampedArray | Uint8Array }>, max = 6): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const { data } of images) {
    for (let i = 0; i + 3 < data.length; i += 4) {
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, a = data[i + 3]!;
      if (a < 128) continue;
      if (r > 235 && g > 235 && b > 235) continue; // near white
      if (r < 20 && g < 20 && b < 20) continue; // near black
      if (saturation(r, g, b) < 0.15) continue; // grey
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); // 32 levels per channel
      const bk = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      bk.n++; bk.r += r; bk.g += g; bk.b += b;
      buckets.set(key, bk);
    }
  }
  const ranked = [...buckets].map(([key, bk]) => ({ key, n: bk.n, rgb: [bk.r / bk.n, bk.g / bk.n, bk.b / bk.n] as [number, number, number] }))
    .sort((x, y) => y.n - x.n || x.key - y.key);
  const kept: Array<{ n: number; rgb: [number, number, number]; lab: [number, number, number] }> = [];
  for (const c of ranked) {
    const lab = toLab(c.rgb);
    const near = kept.find((k) => deltaE(k.lab, lab) < 10);
    if (near) near.n += c.n; else kept.push({ n: c.n, rgb: c.rgb, lab });
  }
  return kept.sort((x, y) => y.n - x.n).slice(0, max).map((k) => hex(k.rgb));
}

function saturation(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2, d = mx - mn;
  return d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
}
const hex = (rgb: [number, number, number]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
function toLab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const deltaE = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/** Draws each screenshot at 64 px on its longest side and extracts the palette. Signed URLs are CORS-enabled for the web origin. */
export async function extractPalette(urls: string[]): Promise<string[]> {
  const images = await Promise.all(urls.map((url) => new Promise<{ data: Uint8ClampedArray } | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const s = 64 / Math.max(img.naturalWidth, img.naturalHeight, 1);
      const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, w, h);
      resolve({ data: ctx.getImageData(0, 0, w, h).data });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  })));
  return paletteFromPixels(images.filter((x): x is { data: Uint8ClampedArray } => !!x));
}
```

Run: `pnpm --filter @chitrapx/web exec vitest run test/colorExtract.test.ts`
Expected: PASS.

- [ ] **Step 3: Palette grid and brand form**

`apps/web/src/components/PaletteGrid.tsx`:

```tsx
"use client";

import { BRAND_TOKENS, contrastRatio, type BrandPalette, type BrandToken } from "@chitrapx/document";

const LABELS: Record<BrandToken, string> = { primary: "Primary", secondary: "Secondary", accent: "Accent", surface: "Surface", text: "Text", muted: "Muted" };
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Six named slots, each a hex field and a picker; Reset restores what is saved. Warns when text on surface is hard to read. */
export function PaletteGrid({ value, onChange, saved }: { value: BrandPalette; onChange: (p: BrandPalette) => void; saved: BrandPalette }) {
  const set = (t: BrandToken, v: string) => { const next = { ...value }; if (v) next[t] = v; else delete next[t]; onChange(next); };
  const ratio = value.text && value.surface ? contrastRatio(value.text, value.surface) : null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {BRAND_TOKENS.map((t) => (
          <div key={t}>
            <label className="label" htmlFor={`pal-${t}`}>{LABELS[t]}</label>
            <div className="flex gap-2">
              <input type="color" aria-label={`${LABELS[t]} picker`} className="h-9 w-10 rounded border border-neutral-300 dark:border-neutral-700"
                value={HEX.test(value[t] ?? "") ? value[t] : "#000000"} onChange={(e) => set(t, e.target.value)} />
              <input id={`pal-${t}`} className={`input ${value[t] && !HEX.test(value[t]!) ? "border-red-500" : ""}`} placeholder="#4F46E5" value={value[t] ?? ""}
                onChange={(e) => set(t, e.target.value.trim())} />
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="text-xs text-neutral-500 hover:underline" onClick={() => onChange(saved)}>Reset</button>
      {ratio !== null && ratio < 4.5 && <p role="status" className="text-xs text-amber-700">Text on Surface is {ratio.toFixed(1)}:1. Aim for at least 4.5:1 so copy stays readable.</p>}
    </div>
  );
}
```

In `BrandForm.tsx`:
- Accept `screenshots: string[]` (URLs).
- Add `const saved = brandPalette(app.brand);`, `const [palette, setPalette] = useState<BrandPalette>(saved);` and `const [found, setFound] = useState<string[] | null>(null);`.
- Render this below the colour fields:

```tsx
        <div className="sm:col-span-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="label">Brand palette</span>
            <button type="button" className="btn-ghost text-sm" disabled={!screenshots.length}
              onClick={async () => setFound(await extractPalette(screenshots))}>Extract from screenshots</button>
          </div>
          {found && (found.length === 0
            ? <p role="status" className="text-xs text-neutral-500">No distinct colours found in these screenshots</p>
            : <div className="flex items-center gap-2">
                {found.map((c) => <span key={c} title={c} className="h-7 w-7 rounded border border-neutral-300" style={{ background: c }} />)}
                <button type="button" className="text-sm text-indigo-600 hover:underline"
                  onClick={() => { setPalette(Object.fromEntries(found.map((c, i) => [BRAND_TOKENS[i]!, c]))); setFound(null); }}>Use these</button>
              </div>)}
          <PaletteGrid value={palette} onChange={setPalette} saved={saved} />
        </div>
```

In `save`, add `palette: BRAND_TOKENS.filter((t) => palette[t] && /^#[0-9a-fA-F]{6}$/.test(palette[t]!)).map((t) => ({ token: t, color: palette[t]! }))` to the `brand` payload.

In `apps/web/src/app/dashboard/apps/[appId]/page.tsx`, pass `screenshots={assets.filter((a) => a.kind === "screenshot" && a.url).map((a) => a.url)}` to `BrandForm`.

- [ ] **Step 4: Brand swatches in the editor**

In `apps/web/src/editor/ui/fields.tsx`:

```tsx
import { BRAND_TOKENS, isColor, parseBrandToken, toBrandToken, type BrandPalette, type BrandToken } from "@chitrapx/document";
import { useEditorAssets } from "../assets.tsx";

export const brandSwatches = (palette: BrandPalette = {}) =>
  BRAND_TOKENS.filter((t) => palette[t]).map((t) => ({ label: t as BrandToken, value: toBrandToken(t), hex: palette[t]! }));
```

In `ColorField`:
- Read `const { extras } = useEditorAssets();` and `const swatches = brandSwatches(extras.palette);`.
- Make the picker show a token's colour: `const shown = parseBrandToken(value) ? extras.palette?.[parseBrandToken(value)!] ?? "#000000" : value;` and use `shown` where `hex` was computed.
- Below the input row, add:

```tsx
      {swatches.length > 0 && (
        <div className="flex gap-1" aria-label="Brand colours">
          {swatches.map((s) => (
            <button key={s.value} type="button" title={`Brand ${s.label}`} aria-label={`Use brand ${s.label}`} onClick={() => onChange(s.value)}
              className={`h-5 w-5 rounded border ${value === s.value ? "ring-2 ring-indigo-500" : "border-neutral-300"}`} style={{ background: s.hex }} />
          ))}
        </div>
      )}
```

`ColorField` is used only inside the editor, under `EditorAssetsProvider`. `BrandForm` has its own `ColorField`.

In `Inspector.tsx`, pass `swatches={brandSwatches(extras.palette)}` to `RichTextToolbar`.

- [ ] **Step 5: Browser check**

Start the web dev server with the dev-server commands in Global Constraints.
- On an app with 3 screenshots, "Extract from screenshots" shows 3–6 swatches in under 1 s, and the same ones again on repeat.
- "Use these", then Save. Reopen the page: the palette is still there.
- In the editor, set a text colour to the Accent swatch: it is drawn in the accent colour.
- Change Accent in the brand form and reopen the editor: the text follows.
- An app with only greyscale screenshots says "No distinct colours found in these screenshots".

Stop the server by PID.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @chitrapx/web test && pnpm typecheck && pnpm lint`
Expected: PASS, apart from the known `billing.ts:61` typecheck error.

```bash
git add apps/web
git commit -m "feat(brand): palette grid with contrast warning, extraction from screenshots, brand swatches in colour fields"
```

---

### Task 14: Headline formulas

**Files:**
- Create: `packages/document/src/copyFormulas.ts`, `packages/document/test/copyFormulas.test.ts`
- Create: `apps/web/src/editor/headlineModel.ts`, `apps/web/src/editor/ui/HeadlineIdeas.tsx`, `apps/web/test/headlineModel.test.ts`
- Modify: `packages/document/src/readiness.ts` (`placeholder`), `packages/document/src/index.ts`, `apps/web/src/editor/ui/LeftPanel.tsx:152` (mount under `CopyIdeas`), `NOTICES.md`
- Test: `packages/document/test/readiness.test.ts` (append)

**Interfaces:**
- Consumes: `contentChecks` (Task 8), commands `updateElement` and `setOverride`.
- Produces (from `@chitrapx/document`):
  - `type FormulaRole = "hero" | "differentiator" | "feature" | "proof" | "closer"`, `FORMULA_ROLES: ReadonlyArray<{ id: FormulaRole; name: string }>`
  - `type Formula = { id: string; role: FormulaRole; template: string; example: string }`, `FORMULAS: Formula[]`
  - `type CategoryBank = { id: string; name: string; lines: Array<{ id: string; text: string }> }`, `CATEGORY_BANKS: CategoryBank[]`
  - `defaultRole(boardIndex, boardCount): FormulaRole`, `PLACEHOLDER: RegExp`, `hasPlaceholder(text): boolean`
  - `contentChecks` emits `placeholder` ("Unfilled placeholder in <board name>")
- Produces (web): `insertHeadline(state: { doc, selection, locale }, text: string): Command | null` in `headlineModel.ts`.

> **Ruling (where the panel goes):** the spec places `HeadlineIdeas` "beside `CopyIdeas.tsx` in the text inspector", but `CopyIdeas` is mounted in `LeftPanel.tsx`, not the inspector. The panel goes in `LeftPanel` under `CopyIdeas`. That also gives "Select a headline first" a real case: nothing, or a non-text element, is selected.

- [ ] **Step 1: Failing tests**

`packages/document/test/copyFormulas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CATEGORY_BANKS, defaultRole, FORMULA_ROLES, FORMULAS, hasPlaceholder } from "../src/index.ts";

describe("headline formulas", () => {
  it("cover all five roles, each formula with a worked example", () => {
    expect(FORMULA_ROLES.map((r) => r.id)).toEqual(["hero", "differentiator", "feature", "proof", "closer"]);
    for (const r of FORMULA_ROLES) expect(FORMULAS.filter((f) => f.role === r.id).length, r.id).toBeGreaterThanOrEqual(4);
    for (const f of FORMULAS) expect(f.example.trim(), f.id).not.toBe("");
  });
  it("have about a dozen category banks of short lines", () => {
    expect(CATEGORY_BANKS.length).toBeGreaterThanOrEqual(12);
    for (const c of CATEGORY_BANKS) {
      expect(c.lines.length, c.id).toBeGreaterThanOrEqual(4);
      for (const l of c.lines) for (const line of l.text.split("\n")) expect(line.length, l.id).toBeLessThanOrEqual(30);
    }
  });
  it("are keyed by unique ids for later localisation", () => {
    const ids = [...FORMULAS.map((f) => f.id), ...CATEGORY_BANKS.flatMap((c) => [c.id, ...c.lines.map((l) => l.id)])];
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("pick a role from the board's position", () => {
    expect([defaultRole(0, 5), defaultRole(2, 5), defaultRole(4, 5), defaultRole(0, 1)]).toEqual(["hero", "feature", "closer", "hero"]);
  });
  it("spot unfilled placeholders", () => {
    expect(hasPlaceholder("[verb] it once.\nTracked forever.")).toBe(true);
    expect(hasPlaceholder("Track habits.")).toBe(false);
    expect(hasPlaceholder("Prices [] here")).toBe(false);
  });
});
```

Append to `packages/document/test/readiness.test.ts`:

```ts
describe("contentChecks: placeholders", () => {
  it("warns once per board with [word] left in, including translations", () => {
    const b1 = board("Hero", [{ ...text("t", 0, 0), content: "The calm way to [verb] [noun]." } as never]);
    const b2 = board("Two", [text("u", 0, 0)]);
    b2.localized = { "de-DE": { u: { content: "Nie wieder [pain]." } } };
    expect(contentChecks(doc([group([b1, b2])]), { customFamilies: [] }).filter((i) => i.code === "placeholder").map((i) => i.message))
      .toEqual(["Unfilled placeholder in Hero", "Unfilled placeholder in Two"]);
  });
});
```

`apps/web/test/headlineModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ChitrapxDoc } from "@chitrapx/document";
import { insertHeadline } from "@/editor/headlineModel.ts";

const doc = { schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [{ code: "de-DE" }] }, groups: [{ id: "g", target: "iphone-6.9", spanElements: [],
  boards: [{ id: "b", name: "b", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#fff", zoom: 1, elements: [
    { id: "t", type: "text", content: "Old", fontSize: 40, color: "#000", fontFamily: "Inter", position: { x: 0, y: 0 }, size: { width: 100, height: 50 }, rotation: 0, scale: 1 },
    { id: "d", type: "device", deviceType: "iphone-15", position: { x: 0, y: 0 }, size: { width: 100, height: 200 }, rotation: 0, scale: 1 }] }] }] } as unknown as ChitrapxDoc;
const ref = (elementId: string) => ({ groupId: "g", boardId: "b", elementId });

describe("insertHeadline", () => {
  it("is one updateElement on the selected text", () => {
    expect(insertHeadline({ doc, selection: [ref("t")], locale: "en-US" }, "Every rep,\ncounted.")).toEqual({ type: "updateElement", ref: ref("t"), props: { content: "Every rep,\ncounted." } });
  });
  it("writes the language's own text in a language view", () => {
    expect(insertHeadline({ doc, selection: [ref("t")], locale: "de-DE" }, "Jede Wiederholung")).toEqual({ type: "setOverride", ref: ref("t"), locale: "de-DE", props: { content: "Jede Wiederholung" } });
  });
  it("needs exactly one text element selected", () => {
    expect(insertHeadline({ doc, selection: [], locale: "en-US" }, "x")).toBeNull();
    expect(insertHeadline({ doc, selection: [ref("d")], locale: "en-US" }, "x")).toBeNull();
    expect(insertHeadline({ doc, selection: [ref("t"), ref("d")], locale: "en-US" }, "x")).toBeNull();
  });
});
```

Run: `pnpm --filter @chitrapx/document exec vitest run test/copyFormulas.test.ts && pnpm --filter @chitrapx/web exec vitest run test/headlineModel.test.ts`
Expected: FAIL. The modules are missing.

- [ ] **Step 2: `copyFormulas.ts`**

```ts
// Formulas and category banks from app-store-screenshots (MIT), skills/app-store-screenshots/copy-ideas.md.
// Placeholders like [verb] stay visible after insertion; readiness flags any left at export.
export type FormulaRole = "hero" | "differentiator" | "feature" | "proof" | "closer";
export type Formula = { id: string; role: FormulaRole; template: string; example: string };
export type CategoryBank = { id: string; name: string; lines: Array<{ id: string; text: string }> };

export const FORMULA_ROLES: ReadonlyArray<{ id: FormulaRole; name: string }> = [
  { id: "hero", name: "Hero" }, { id: "differentiator", name: "Differentiator" }, { id: "feature", name: "Feature" },
  { id: "proof", name: "Proof" }, { id: "closer", name: "Closer" },
];

const f = (role: FormulaRole, id: string, template: string, example: string): Formula => ({ id: `${role}.${id}`, role, template, example });
export const FORMULAS: Formula[] = [
  f("hero", "outcome-without-pain", "[outcome], without [pain].", "Great coffee, without the guesswork."),
  f("hero", "adjective-way", "The [adjective] way to [verb] [noun].", "The calm way to plan your week."),
  f("hero", "your-noun-benefit", "Your [noun],\n[benefit].", "Your money,\nfinally clear."),
  f("hero", "verb-noun-twice", "[verb] [noun].\n[verb] [noun].", "Track habits.\nKeep streaks."),
  f("hero", "every-noun", "Every [noun],\n[outcome].", "Every workout,\ncounted."),
  f("hero", "noun-that-verbs", "[noun] that [verb]s you.", "A journal that listens back."),
  f("hero", "meet-your-role", "Meet your new [role].", "Meet your new sleep coach."),
  f("differentiator", "only-app", "Only [app] [does unique thing].", "Only Bloom knows when beans peak."),
  f("differentiator", "others-vs-app", "[Competitor category] [does X].\n[app] [does Y].", "Timers count down.\nBloom coaches each pour."),
  f("differentiator", "no-no-just", "No [pain]. No [pain]. Just [outcome].", "No ads. No streak guilt. Just progress."),
  f("differentiator", "built-for", "Built for [specific person].", "Built for people who read slowly."),
  f("differentiator", "once-forever", "[verb] it once.\n[outcome] forever.", "Scan it once.\nTracked forever."),
  f("feature", "in-time", "[verb] [noun] in [time/number].", "Log a meal in 3 seconds."),
  f("feature", "at-a-glance", "See [thing] at a glance.", "See your whole month at a glance."),
  f("feature", "sorted", "[noun], sorted.", "Your shelf, sorted by freshness."),
  f("feature", "never-again", "Never [pain] again.", "Never miss a refill again."),
  f("feature", "from-to", "From [before] to [after].", "From receipt to budget in one tap."),
  f("feature", "app-does-rest", "[verb] it. [app] does the rest.", "Snap the bag. Bloom does the rest."),
  f("feature", "on-your-surface", "Right on your [surface].", "Right on your lock screen."),
  f("proof", "people-use", "[number] [people] [verb] [app].", "40,000 runners train with Stride."),
  f("proof", "loved-by", "Loved by [specific group].", "Loved by home baristas."),
  f("proof", "rating", "[rating] from [number] reviews.", "4.9 stars from 12,000 reviews."),
  f("proof", "private", "Private by design.", "Private by design. Your data stays on device."),
  f("proof", "as-seen-in", "As seen in [publication].", "Use only for a real, permitted press mention."),
  f("closer", "wordlist", "[feature] · [feature] · [feature] · [feature]", "Widgets · Journal · Recipes · Caffeine · Scanner"),
  f("closer", "quiet-statement", "And it's all [yours].", "And it's all yours."),
  f("closer", "invitation", "Your first [period] starts today.", "Your first week starts today."),
  f("closer", "so-much-more", "[feature] · [feature] · [feature] · and so much more", "Dark mode · iCloud sync · Siri · Shortcuts"),
  f("closer", "identity", "Made for people who [value].", "Made for people who care about the details."),
];

const bank = (id: string, name: string, lines: string[]): CategoryBank => ({ id: `bank.${id}`, name, lines: lines.map((text, i) => ({ id: `bank.${id}.${i + 1}`, text })) });
export const CATEGORY_BANKS: CategoryBank[] = [
  bank("productivity", "Productivity & tasks", ["Your whole day,\nin one list.", "Turn notes into\nnext steps.", "Plan less.\nDo more.", "Inbox zero,\nfinally.", "Talk it out.\nWe'll write it down."]),
  bank("notes", "Notes & writing", ["Write first.\nOrganize later.", "Every idea,\nfound in seconds.", "A quiet place\nto think.", "Your second brain,\nwithout the setup."]),
  bank("finance", "Finance & budgeting", ["Your money,\nfinally clear.", "Know where\nevery dollar goes.", "Split bills.\nKeep friends.", "Save without\nthinking about it.", "Budgets that\nbend, not break."]),
  bank("fitness", "Fitness & running", ["Every rep,\ncounted.", "Train smarter,\nnot longer.", "Beat last week.", "Your pace.\nYour plan.", "Recover like\nyou mean it."]),
  bank("health", "Health, sleep & wellness", ["Sleep deeper\ntonight.", "Two minutes\nto calm.", "Feel it before\nyou burn out.", "Slow mornings,\nmade simple.", "Understand your\ncycle, gently."]),
  bank("food", "Food, recipes & drink", ["Dinner, decided.", "Cook what's\nalready in the fridge.", "Every recipe,\none tap away.", "Great coffee,\nwithout the guesswork.", "Taste more.\nWaste less."]),
  bank("social", "Social, friends & events", ["Plans your friends\nactually show up to.", "See what your\nfriends are up to.", "The group chat,\nbut for real life.", "Your people,\nin one place."]),
  bank("dating", "Dating & relationships", ["Fewer swipes.\nBetter dates.", "Meet people\nworth your time.", "Stay close,\nfrom anywhere.", "Your little world,\ntogether."]),
  bank("learning", "Learning & education", ["Five minutes\na day is enough.", "Learn it.\nKeep it.", "Speak from\nday one.", "Study smarter\nfor finals."]),
  bank("photo", "Photo, video & creative", ["Edits that\nlook expensive.", "Your best shot,\nin one tap.", "Make it yours.", "Pro tools,\nno learning curve."]),
  bank("travel", "Travel & maps", ["Every trip,\nplanned in minutes.", "Your itinerary,\noffline.", "Find the places\nlocals love.", "Pack once.\nNever forget."]),
  bank("developer", "Developer & pro tools", ["Ship faster\nfrom your phone.", "Every log,\nsearchable.", "Your servers,\nin your pocket.", "Alerts that\nactually matter."]),
  bank("kids", "Kids & family", ["Screen time\nthat teaches.", "The family calendar\neveryone uses.", "Chores, turned\ninto a game.", "Bedtime,\nwithout the battle."]),
];

/** First board = hero, last = closer, the rest = feature. */
export const defaultRole = (boardIndex: number, boardCount: number): FormulaRole =>
  boardIndex === 0 ? "hero" : boardIndex === boardCount - 1 ? "closer" : "feature";

/** A formula placeholder such as [verb] or [Competitor category]. */
export const PLACEHOLDER = /\[[^\]\n]{1,40}\]/;
export const hasPlaceholder = (text: string) => PLACEHOLDER.test(text);
```

"Bedtime,\nwithout the battle." is one line we wrote ourselves, so the Kids bank reaches four lines (the source has three). Add `export * from "./copyFormulas.ts";` to the index.

In `readiness.ts` `contentChecks`:
- Import `hasPlaceholder` from `./copyFormulas.ts`.
- Inside the per-board loop, for real boards only (skip the span-elements entry), add:

```ts
      if (part !== g.spanElements) {
        const b = part as ArtboardState;
        const texts = [...b.elements.filter((e) => e.type === "text").map((e) => (e as TextElementProps).content ?? ""),
          ...Object.values(b.localized ?? {}).flatMap((byEl) => Object.values(byEl).map((ov) => ov.content ?? ""))];
        if (texts.some(hasPlaceholder)) out.push({ severity: "warning", code: "placeholder", message: `Unfilled placeholder in ${b.name}`, groupId: g.id, boardIndex });
      }
```

Import `type ArtboardState, type TextElementProps` from `./artboard.ts`.

Add a row to `NOTICES.md`:

```markdown
| [app-store-screenshots](https://github.com/ParthJadhav/app-store-screenshots) (MIT) | Copyright (c) 2026 Parth Jadhav | Headline formulas and category banks (`packages/document/src/copyFormulas.ts`, from `skills/app-store-screenshots/copy-ideas.md`). |
```

- [ ] **Step 3: Insert helper and panel**

`apps/web/src/editor/headlineModel.ts`:

```ts
import type { ChitrapxDoc } from "@chitrapx/document";
import { findElement, type Command, type Ref } from "./commands.ts";

/** The one command that puts `text` into the single selected text element (its language's own text in a language view), or null. */
export function insertHeadline(state: { doc: ChitrapxDoc; selection: Ref[]; locale: string }, text: string): Command | null {
  const ref = state.selection.length === 1 ? state.selection[0]! : null;
  if (!ref || findElement(state.doc, ref)?.type !== "text") return null;
  if (state.locale !== state.doc.localization.baseLocale && ref.boardId) return { type: "setOverride", ref, locale: state.locale, props: { content: text } };
  return { type: "updateElement", ref, props: { content: text } as never };
}
```

`apps/web/src/editor/ui/HeadlineIdeas.tsx`:

```tsx
"use client";

import { useState } from "react";
import { CATEGORY_BANKS, defaultRole, FORMULA_ROLES, FORMULAS, type FormulaRole } from "@chitrapx/document";
import { useEditor, useEditorStore } from "../context.tsx";
import { insertHeadline } from "../headlineModel.ts";

const longest = (t: string) => Math.max(...t.split("\n").map((l) => l.length));

/** Offline headline formulas by slide role and example lines by category; a click inserts into the selected text. */
export function HeadlineIdeas() {
  const store = useEditorStore();
  const boardIndex = useEditor((s) => s.doc.groups.find((g) => g.id === s.activeGroupId)?.boards.findIndex((b) => b.id === s.activeBoardId) ?? 0);
  const boardCount = useEditor((s) => s.doc.groups.find((g) => g.id === s.activeGroupId)?.boards.length ?? 1);
  const [role, setRole] = useState<FormulaRole | "auto">("auto");
  const [category, setCategory] = useState(CATEGORY_BANKS[0]!.id);
  const [notice, setNotice] = useState("");
  const shownRole = role === "auto" ? defaultRole(Math.max(0, boardIndex), boardCount) : role;
  const insert = (text: string) => {
    const s = store.getState();
    const cmd = insertHeadline(s, text);
    if (!cmd) { setNotice("Select a headline first"); return; }
    setNotice("");
    s.apply(cmd);
  };
  const Line = ({ text, hint }: { text: string; hint?: string }) => (
    <li>
      <button type="button" onClick={() => insert(text)} className="w-full rounded px-1.5 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <span className="whitespace-pre-line">{text}</span>
        <span className="ml-1 text-neutral-400">{longest(text)}/30</span>
        {hint && <span className="block whitespace-pre-line text-neutral-500">e.g. {hint}</span>}
      </button>
    </li>
  );
  return (
    <section className="space-y-2">
      <h2 className="label">Headline ideas</h2>
      <select className="input" aria-label="Slide role" value={role} onChange={(e) => setRole(e.target.value as FormulaRole | "auto")}>
        <option value="auto">For this board ({FORMULA_ROLES.find((r) => r.id === shownRole)!.name})</option>
        {FORMULA_ROLES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <ul className="max-h-48 space-y-0.5 overflow-y-auto">{FORMULAS.filter((x) => x.role === shownRole).map((x) => <Line key={x.id} text={x.template} hint={x.example} />)}</ul>
      <select className="input" aria-label="App category" value={category} onChange={(e) => setCategory(e.target.value)}>
        {CATEGORY_BANKS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <ul className="space-y-0.5">{CATEGORY_BANKS.find((c) => c.id === category)!.lines.map((l) => <Line key={l.id} text={l.text} />)}</ul>
      {notice && <p role="status" className="text-xs text-amber-700">{notice}</p>}
      <p className="text-xs text-neutral-500">Keep each line under 30 characters. Replace every [placeholder].</p>
    </section>
  );
}
```

In `apps/web/src/editor/ui/LeftPanel.tsx`, import `HeadlineIdeas` and render `<HeadlineIdeas />` directly after `<CopyIdeas />`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/web exec vitest run test/headlineModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: only `billing.ts:61`.

```bash
git add packages/document apps/web NOTICES.md
git commit -m "feat(editor): offline headline formulas by slide role and category; unfilled placeholders flagged before export"
```

---

### Task 15: CarPlay frame

**Files:**
- Modify: `packages/document/src/artboard.ts` (`DeviceType` adds `'carplay'`)
- Modify: `packages/renderer/src/osg/lib/deviceRegistry.ts:5` (`DeviceCategory` adds `'vehicle'`), `:40-75` (descriptor), `:87-112` (picker group)
- Modify: `packages/renderer/src/osg/elements/deviceChrome.tsx:19-40` (`FlatDeviceChrome.frameShadow`), `:217-317` (`case 'carplay'`), `:345-380` (`getFlatFrameStyles` uses `frameShadow`)
- Modify: `apps/web/src/editor/geometry.ts` (`fitLandscape`), `apps/web/src/editor/ui/Inspector.tsx` (device picker with a Vehicle group; resize on switch)
- Modify: `NOTICES.md` (append to the app-store-screenshots row)
- Test: `packages/renderer/test/carplay.test.ts` (create), `packages/document/test/exportPlan.test.ts` (append), `apps/web/test/geometry.test.ts` (append), `apps/worker/test-e2e/export.test.ts` (append)
- Golden: `packages/assets/golden/carplay.png` (create)

**Interfaces:**
- Produces:
  - `DEVICE_REGISTRY.carplay = { id: "carplay", label: "CarPlay", platform: "ios", category: "vehicle", nativeAspect: 800 / 480, screen: { paddingPercent: 1.6 all sides, radiusFactor: 0.014 } }` with no counterpart. `DEVICE_PICKER_GROUPS` gains `{ label: "Vehicle", platform: "ios" }`.
  - `getFlatDeviceChrome("carplay", w)`: `outerBorderRadius: "2.2% / 3.6%"`, `screenBorderRadius: "1.4% / 2.3%"`, `bodyColor: "#0B0B0D"`, and a `frameShadow`.
  - `fitLandscape(board: { width: number; height: number }, aspect: number, widthPct?: number): { position: { x: number; y: number }; size: { width: number; height: number } }`

> **Fact:** the export plan picks targets from the board group, not from devices (`exportPlan.ts` `sourcesFor`). A CarPlay board on an iPhone group therefore already exports into the iPhone slot, and no `exportPlan.ts` or `targets.ts` change is needed. The test pins this.

- [ ] **Step 1: Failing tests**

`packages/renderer/test/carplay.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEVICE_PICKER_GROUPS, DEVICE_REGISTRY, getDeviceDescriptor, swapTargetFor } from "../src/osg/lib/deviceRegistry";
import { getFlatDeviceChrome, getFlatFrameStyles } from "../src/osg/elements/deviceChrome";

describe("CarPlay device", () => {
  it("is a landscape iOS vehicle frame with no counterpart", () => {
    expect(getDeviceDescriptor("carplay")).toMatchObject({ label: "CarPlay", platform: "ios", category: "vehicle", nativeAspect: 800 / 480 });
    expect(DEVICE_REGISTRY.carplay.screen!.paddingPercent).toEqual({ top: 1.6, right: 1.6, bottom: 1.6, left: 1.6 });
    expect(swapTargetFor("carplay", "android")).toBeNull();
    expect(swapTargetFor("carplay", "ios")).toBeNull();
  });
  it("appears in its own Vehicle picker group and in no other", () => {
    const vehicle = DEVICE_PICKER_GROUPS.find((g) => g.label === "Vehicle")!;
    expect(vehicle.devices.map((d) => d.id)).toEqual(["carplay"]);
    expect(DEVICE_PICKER_GROUPS.filter((g) => g.devices.some((d) => d.id === "carplay"))).toHaveLength(1);
  });
  it("draws a near-black head unit with proportional corners and a soft shadow", () => {
    const chrome = getFlatDeviceChrome("carplay", 800);
    expect(chrome).toMatchObject({ outerBorderRadius: "2.2% / 3.6%", screenBorderRadius: "1.4% / 2.3%", bodyColor: "#0B0B0D" });
    const { frame, screen } = getFlatFrameStyles(chrome, 800, {});
    expect(frame.boxShadow).toBe("0 20px 60px rgba(0,0,0,0.40), inset 0 0 0 1px rgba(255,255,255,0.07)");
    expect(screen.top).toBe("12.8px"); // 1.6% of 800
  });
  it("leaves the other devices as they were", () => {
    expect(getFlatDeviceChrome("iphone-15", 400).outerBorderRadius).toBe(`${400 * 0.14}px`);
    expect(getFlatFrameStyles(getFlatDeviceChrome("iphone-15", 400), 400, {}).frame.boxShadow).toBe("0 4px 12px rgba(0,0,0,0.3)");
  });
});
```

Append to `packages/document/test/exportPlan.test.ts`:

```ts
describe("CarPlay boards", () => {
  it("export into the iPhone slot; no new store target", () => {
    const d = doc([group([board("b1", [{ ...device("cp", 100), deviceType: "carplay", size: { width: 1160, height: 696 } } as never])])]);
    const plan = exportPlan(d, { targets: ["iphone-6.9"], locales: ["en-US"] });
    expect(plan.map((p) => [p.targetId, p.width, p.height])).toEqual([["iphone-6.9", 1290, 2796]]);
    expect(checkExportable(d, { targets: ["iphone-6.9"], locales: ["en-US"] }).ok).toBe(true);
    expect(storeReadiness(plan, d).filter((i) => i.severity === "error")).toEqual([]);
  });
});
```

Import `checkExportable`, `exportPlan`, `storeReadiness`, `device`, `board`, `doc` and `group` if the file does not already. An iPhone 6.9" set of one board passes the App Store rules.

Append to `apps/web/test/geometry.test.ts`:

```ts
import { fitLandscape } from "@/editor/geometry.ts";

describe("fitLandscape", () => {
  it("fits a landscape frame to 90% of a portrait board's width, centred", () => {
    expect(fitLandscape({ width: 1290, height: 2796 }, 800 / 480)).toEqual({ position: { x: 64.5, y: 1049.7 }, size: { width: 1161, height: 696.6 } });
  });
});
```

Run: `pnpm --filter @chitrapx/renderer exec vitest run test/carplay.test.ts`
Expected: FAIL. `carplay` is not in the registry.

- [ ] **Step 2: Registry and chrome**

The frame is ported from app-store-screenshots (MIT), `template/src/components/editor/device-frames.tsx` `CarPlayScreen`.

- In `packages/document/src/artboard.ts`, add `| 'carplay'` to `DeviceType`, after `'imac'`.
- In `deviceRegistry.ts`, change `DeviceCategory` to `'phone' | 'tablet' | 'watch' | 'desktop' | 'vehicle' | 'custom'`.
- Add to `DEVICE_REGISTRY`, after `imac`:

```ts
  // CarPlay head unit (Apple's "Standard" 800x480 simulator preset). It has no store slot of its
  // own: the shot ships at an iPhone size, so it lives on iPhone boards. Ported from
  // app-store-screenshots (MIT) CarPlayScreen. No counterpart: swaps leave it alone.
  'carplay': { id: 'carplay', label: 'CarPlay', platform: 'ios', category: 'vehicle', nativeAspect: 800 / 480, screen: { paddingPercent: { top: 1.6, right: 1.6, bottom: 1.6, left: 1.6 }, radiusFactor: 0.014 } },
```

- In `DEVICE_PICKER_GROUPS`, add `{ label: 'Vehicle', platform: 'ios', category: 'vehicle' },` after the `Mac` entry.

In `deviceChrome.tsx`:
- Add `frameShadow?: string;` with the comment `/** Replaces the default soft drop shadow (CarPlay's deeper shadow plus a hairline rim). */` to `FlatDeviceChrome`.
- Add the case before `case 'apple-watch':`:

```ts
    case 'carplay':
      // Proportional radii (horizontal / vertical), as in the reference frame.
      chrome.outerBorderRadius = '2.2% / 3.6%';
      chrome.screenBorderRadius = '1.4% / 2.3%';
      chrome.bodyColor = '#0B0B0D';
      chrome.frameShadow = '0 20px 60px rgba(0,0,0,0.40), inset 0 0 0 1px rgba(255,255,255,0.07)';
      break;
```

- In `getFlatFrameStyles`, change the `boxShadow` line to `boxShadow: hasChassis || isOutline || frameAlpha < 1 ? 'none' : chrome.frameShadow ?? '0 4px 12px rgba(0,0,0,0.3)',`.

Append to the app-store-screenshots row in `NOTICES.md`: `; CarPlay head-unit frame proportions (`packages/renderer/src/osg/elements/deviceChrome.tsx`, from `template/src/components/editor/device-frames.tsx` `CarPlayScreen`)`.

- [ ] **Step 3: Device picker with a Vehicle group**

In `apps/web/src/editor/geometry.ts`:

```ts
/** A frame of `aspect` (width/height) at `widthPct` of the board's width, centred: how a landscape frame sits on a portrait board. */
export function fitLandscape(board: { width: number; height: number }, aspect: number, widthPct = 0.9) {
  const width = Math.round(board.width * widthPct * 10) / 10;
  const height = Math.round((width / aspect) * 10) / 10;
  return { position: { x: Math.round(((board.width - width) / 2) * 10) / 10, y: Math.round(((board.height - height) / 2) * 10) / 10 }, size: { width, height } };
}
```

In `Inspector.tsx`, replace the flat `DEVICES` list with groups, and the device `SelectField` with a grouped select:

```tsx
const DEVICE_GROUPS = [
  { label: "iPhone", options: [["iphone-17-pro-max", "iPhone 17 Pro Max"], ["iphone-15", "iPhone 15"], ["iphone-15-pro", "iPhone 15 Pro"], ["iphone-x", "iPhone X"]] },
  { label: "iPad", options: [["ipad-pro-13", "iPad Pro 13"], ["ipad-11", "iPad 11"]] },
  { label: "Android", options: [["android-punch-hole", "Android"], ["tablet-10", "Android tablet"]] },
  { label: "Mac and watch", options: [["macbook", "MacBook"], ["imac", "iMac"], ["apple-watch", "Apple Watch"]] },
  { label: "Vehicle", options: [["carplay", "CarPlay"]] },
] as const;
const DEVICES = DEVICE_GROUPS.flatMap((g) => g.options);

function DeviceSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const known = DEVICES.some(([v]) => v === value);
  return (
    <Row label="Model" htmlFor={id}>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {!known && <option value={value}>{value}</option>}
        {DEVICE_GROUPS.map((g) => <optgroup key={g.label} label={g.label}>{g.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>)}
      </select>
    </Row>
  );
}
```

For the screenshot device, add a board-size lookup in `ElementInspector`: `const boardSize = useEditor((s) => s.doc.groups.find((g) => g.id === refr.groupId)?.boards.find((b) => b.id === refr.boardId)?.size);`. Then use:

```tsx
          <DeviceSelect id="i-device" value={a.deviceType ?? "iphone-15"}
            onChange={(v) => set(v === "carplay" && a.deviceType !== "carplay" && boardSize ? { deviceType: v, ...fitLandscape(boardSize, 800 / 480) } : { deviceType: v })} />
```

For the video device, use `<DeviceSelect id="i-vdevice" value={a.deviceType ?? "iphone-17-pro-max"} onChange={(v) => set({ deviceType: v })} />`. Remove the now-unused `withCurrent(DEVICES, …)` calls for devices.

- [ ] **Step 4: Run the unit tests**

Run: `pnpm --filter @chitrapx/renderer test && pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/web exec vitest run test/geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: E2E golden**

Append to `apps/worker/test-e2e/export.test.ts`:

```ts
describe("CarPlay (SP10)", () => {
  it("a CarPlay frame on an iPhone board matches its golden", async () => {
    const doc = await templateDoc("amoura-dating");
    const b = doc.groups[0]!.boards[0]!;
    const dev = b.elements.find((e) => e.type === "device") as Record<string, unknown>;
    Object.assign(dev, { deviceType: "carplay", styleType: "normal", rotation: 0, position: { x: 64.5, y: 1049.7 }, size: { width: 1161, height: 696.6 }, scale: 1 });
    const { ws, appId } = await workspaceWithApp();
    compareGolden("carplay.png", await singleBoardPng(ws, appId, doc));
  }, 180_000);
});
```

Start the web server with the dev-server commands in Global Constraints, then run: `pnpm --filter @chitrapx/worker exec vitest run --config vitest.e2e.config.ts -t "CarPlay"`. Open `packages/assets/golden/carplay.png`. It must show a wide near-black head unit with rounded corners, centred, with the template's screenshot filling the screen. Rerun the whole suite. Expected: PASS. Stop the server by PID.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: only `billing.ts:61`.

```bash
git add packages apps/web apps/worker/test-e2e NOTICES.md
git commit -m "feat(devices): CarPlay head-unit frame in a Vehicle group; exports into the iPhone slot"
```

---

### Task 16: Eighteen named styles, the style picker and previews

**Files:**
- Create: `packages/document/src/styles.ts`, `packages/document/test/styles.test.ts`
- Modify: `packages/document/src/artboard.ts` (`TextElementProps.textTransform`), `packages/document/src/index.ts`
- Modify: `packages/renderer/src/osg/elements/TextElement.tsx` (`textTransform`), `packages/renderer/src/osg/lib/textFit.ts` (probe `textTransform`), `packages/renderer/src/index.ts` (export `fitTextBox`)
- Modify: `apps/web/src/editor/commands.ts` (`applyStyle` command), `apps/web/src/editor/ui/LeftPanel.tsx`, `apps/web/src/editor/ui/Inspector.tsx` (Case field)
- Create: `apps/web/src/editor/ui/StylePicker.tsx`
- Create: `apps/worker/scripts/gen-style-previews.ts`, `apps/web/public/styles/<id>.png` (18, generated)
- Modify: `apps/worker/tsconfig.json` (`include` adds `"scripts"`), `NOTICES.md`
- Test: `apps/web/test/commands.test.ts` (append), `packages/renderer/test/textMarks.test.tsx` (append)

**Interfaces:**
- Consumes: fonts in `FONT_CATALOG` (Task 4), `BrandToken`/`BRAND_TOKENS` (Task 12), `Gradient` (Task 9), `contrastRatio` (`aso.ts`), `fitTextBox`, `ensureFont` (renderer).
- Produces (from `@chitrapx/document`):
  - `type TextCase = "none" | "upper" | "lower"`
  - `type StyleDef = { id; name; description; fonts: { heading; body }; palette: Record<BrandToken, string>; background: { color: string } | { gradient: Gradient }; headline: { sizePct: [number, number]; weight; tracking; lineHeight; case: TextCase; align: "left" | "center" | "right" }; body: { weight; lineHeight; case; align }; device: { rotation: number; shadow: ElementShadow | null; frameStyle: "solid" | "outline" } }`
  - `STYLES: StyleDef[]` (18), `getStyle(id)`
  - `applyStyle(doc, groupId, styleId): ChitrapxDoc`
  - `STYLE_FIELDS: { board: string[]; text: string[]; device: string[] }`
  - `TextElementProps.textTransform?: "uppercase" | "lowercase"`
- Produces (web): command `{ type: "applyStyle"; groupId: string; styleId: string; fits?: Record<string, { size: { width: number; height: number }; position: { x: number; y: number } }> }`, where `fits` is keyed `"<boardId>:<elementId>"`.

> **Ruling (style values):** values come from each style prompt's typography and hard-rule sections (app-store-screenshots, MIT).
> - **Fonts:** commercial or non-Google faces are swapped for catalogue families: Cooper Black → Fraunces 900, Tiempos → Playfair Display, Pretendard → Inter, the Caveat Brush marker → Permanent Marker. Every style also defines a body font.
> - **Headline size:** the prompts give pixel ranges at a 1320 px canvas. `sizePct` is that range as a percentage of board width.
> - **Backgrounds:** board gradients render only two stops (`backgroundGradient {color1, color2, angle}`), so style gradients use the prompt's first and last stops.
> - **Deliberately left out:** decorative art (grids, mascots, stickers, noise) and the prompts' one-word emphasis. Those need new element types or marks the style cannot know where to put. Descriptions are written fresh.
>
> **Ruling (stable application):** `applyStyle` must make A-then-B equal B alone. So:
> - The headline is the text with the smallest `position.y` (layer order breaks ties). `applyStyle` never moves anything, so this choice is the same for every style.
> - Its size is the midpoint of `sizePct`, never "the current size clamped". Clamping would make the result depend on the previous style.
> - The editor command then grows clipped text boxes with `fitTextBox`, measured after the style's fonts load, in the same command.
>
> **Ruling (case):** text has no case property today, so `textTransform` is added. CSS `text-transform` leaves `content` and mark offsets untouched.

- [ ] **Step 1: Failing tests**

`packages/document/test/styles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyStyle, catalogFont, contrastRatio, matchWeight, migrate, STYLE_FIELDS, STYLES, type ChitrapxDoc } from "../src/index.ts";
import { board, device, doc, group, text } from "./fixtures.ts";

const sample = (): ChitrapxDoc => {
  const b1 = board("b1", [{ ...text("h", 0, 100), content: "Track habits", marks: [{ start: 0, end: 5, fontWeight: 800 }] } as never, { ...text("s", 0, 600), fontSize: 30 } as never, device("d", 300, "asset:00000000-0000-0000-0000-000000000001")]);
  b1.localized = { "de-DE": { h: { content: "Gewohnheiten" } } };
  const d = doc([group([b1, board("b2", [text("h2", 0, 100)])])]);
  d.localization.locales = [{ code: "de-DE" }];
  return migrate(d);
};
const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const styleFields = (d: ChitrapxDoc) => d.groups[0]!.boards.map((b) => ({
  board: pick(b as never, STYLE_FIELDS.board),
  els: b.elements.map((e) => pick(e as never, e.type === "text" ? STYLE_FIELDS.text : STYLE_FIELDS.device)),
}));

describe("named styles", () => {
  it("ships 18 with unique ids", () => {
    expect(STYLES).toHaveLength(18);
    expect(new Set(STYLES.map((s) => s.id)).size).toBe(18);
  });
  it("every headline colour reads on its background (4.5:1, gradients at their worst stop)", () => {
    for (const s of STYLES) {
      const bgs = "gradient" in s.background ? s.background.gradient.stops.map((x) => x.color) : [s.background.color];
      expect(Math.min(...bgs.map((bg) => contrastRatio(s.palette.text, bg)!)), s.id).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("uses only catalogue fonts, in weights they have", () => {
    for (const s of STYLES) {
      for (const [family, weight] of [[s.fonts.heading, s.headline.weight], [s.fonts.body, s.body.weight]] as const) {
        const f = catalogFont(family);
        expect(f, `${s.id}: ${family}`).toBeDefined();
        expect(matchWeight(f!.weights, weight), `${s.id}: ${family} ${weight}`).toBe(weight);
      }
    }
  });
  it("applying twice equals applying once", () => {
    for (const s of STYLES) {
      const once = applyStyle(sample(), "g1", s.id);
      expect(applyStyle(once, "g1", s.id), s.id).toBe(once);
    }
  });
  it("applying B after A equals applying B alone, on every style field", () => {
    for (const a of STYLES) {
      const b = STYLES[(STYLES.indexOf(a) + 7) % STYLES.length]!;
      expect(styleFields(applyStyle(applyStyle(sample(), "g1", a.id), "g1", b.id)), `${a.id} then ${b.id}`).toEqual(styleFields(applyStyle(sample(), "g1", b.id)));
    }
  });
  it("sets the background, headline, body and device treatment, and the group's styleId", () => {
    const out = applyStyle(sample(), "g1", "swiss-grid-bold");
    const b = out.groups[0]!.boards[0]!;
    expect(out.groups[0]!.styleId).toBe("swiss-grid-bold");
    expect(b).toMatchObject({ backgroundType: "solid", backgroundColor: "#F2F1EC" });
    expect(b.elements[0]).toMatchObject({ fontFamily: "Inter Tight", fontWeight: "800", color: "#0E0E0C", textAlign: "left", lineHeight: 0.9 });
    expect((b.elements[0] as unknown as { fontSize: number }).fontSize).toBeCloseTo(1290 * 0.1325 * 0.3, 1);
    expect(b.elements[1]).toMatchObject({ fontFamily: "Inter Tight", fontWeight: "500", color: "#5E5D57", fontSize: 30 });
    expect(b.elements[2]).toMatchObject({ rotation: 0, frameStyle: "solid" });
    expect(applyStyle(sample(), "g1", "neon-athletic-night").groups[0]!.boards[0]!.elements[0]).toMatchObject({ textTransform: "uppercase" });
  });
  it("never touches content, marks, screenshots or translations", () => {
    const before = sample();
    const after = applyStyle(before, "g1", "candy-pop-social").groups[0]!.boards[0]!;
    const was = before.groups[0]!.boards[0]!;
    expect(after.elements[0]).toMatchObject({ content: "Track habits", marks: [{ start: 0, end: 5, fontWeight: 800 }] });
    expect((after.elements[2] as unknown as { screenshotSrc: string }).screenshotSrc).toBe((was.elements[2] as unknown as { screenshotSrc: string }).screenshotSrc);
    expect(after.localized).toEqual(was.localized);
  });
  it("leaves the document alone when there is nothing to apply to", () => {
    const d = sample();
    expect(applyStyle(d, "g1", "no-such-style")).toBe(d);
    expect(applyStyle(d, "missing-group", "swiss-grid-bold")).toBe(d);
  });
  it("a styled document is still a valid document", () => {
    for (const s of STYLES) expect(() => migrate(applyStyle(sample(), "g1", s.id)), s.id).not.toThrow();
  });
});
```

Append to `apps/web/test/commands.test.ts`:

```ts
describe("applyStyle command", () => {
  it("applies a style and the measured text boxes as one step; nothing to apply returns the same doc", () => {
    const d = doc();
    const out = applyCommand(d, { type: "applyStyle", groupId: "g", styleId: "quiet-japandi", fits: { "b1:a": { size: { width: 100, height: 400 }, position: { x: 0, y: 0 } } } });
    expect(out.groups[0]!.styleId).toBe("quiet-japandi");
    expect(findElement(out, r("a"))!.size).toEqual({ width: 100, height: 400 });
    expect(applyCommand(d, { type: "applyStyle", groupId: "g", styleId: "nope" })).toBe(d);
  });
});
```

Append to `packages/renderer/test/textMarks.test.tsx`:

```tsx
describe("text case", () => {
  it("is drawn with text-transform, leaving the content alone", () => {
    expect(html({ textTransform: "uppercase" })).toContain("text-transform:uppercase");
    expect(html({ textTransform: "uppercase" })).toContain(">Track habits</div>");
  });
});
```

Run: `pnpm --filter @chitrapx/document exec vitest run test/styles.test.ts`
Expected: FAIL. `styles.ts` is missing.

- [ ] **Step 2: `styles.ts`**

```ts
// Style names and numeric values from app-store-screenshots (MIT), skills/app-store-screenshots/style-prompts/
// 01–18. Descriptions are our own. Only what the renderer draws today: background, fonts, colours, text and device treatment.
import { produce } from "immer";
import type { ElementShadow } from "./artboard.ts";
import type { BrandToken } from "./brand.ts";
import type { ChitrapxDoc } from "./doc.ts";
import type { Gradient } from "./gradient.ts";

export type TextCase = "none" | "upper" | "lower";
type Align = "left" | "center" | "right";
export type StyleDef = {
  id: string; name: string; description: string;
  fonts: { heading: string; body: string };
  palette: Record<BrandToken, string>;
  background: { color: string } | { gradient: Gradient };
  headline: { sizePct: [number, number]; weight: number; tracking: number; lineHeight: number; case: TextCase; align: Align };
  body: { weight: number; lineHeight: number; case: TextCase; align: Align };
  device: { rotation: number; shadow: ElementShadow | null; frameStyle: "solid" | "outline" };
};

const lin = (angle: number, from: string, to: string): { gradient: Gradient } => ({ gradient: { kind: "linear", angle, stops: [{ color: from, at: 0 }, { color: to, at: 1 }] } });
const pal = (primary: string, secondary: string, accent: string, surface: string, text: string, muted: string) => ({ primary, secondary, accent, surface, text, muted });
const shadow = (x: number, y: number, blur: number, color: string): ElementShadow => ({ x, y, blur, color });

export const STYLES: StyleDef[] = [
  { id: "retro-rubberhose-mascot", name: "Retro Rubberhose", description: "Warm cream paper, chunky soft serif headlines in dark brown ink, like a 1930s cartoon poster.",
    fonts: { heading: "Fraunces", body: "Nunito" }, palette: pal("#F2BB46", "#F19A8E", "#C0392B", "#F4E6CC", "#2A2118", "#5C3A1E"), background: { color: "#F4E6CC" },
    headline: { sizePct: [6.8, 7.7], weight: 900, tracking: -0.01, lineHeight: 1.05, case: "none", align: "left" }, body: { weight: 700, lineHeight: 1.3, case: "none", align: "left" },
    device: { rotation: 0, shadow: shadow(0, 24, 48, "rgba(92,58,30,0.25)"), frameStyle: "solid" } },
  { id: "moody-curated-dating", name: "Moody Curated", description: "Candle-lit near-black grounds with a large cream serif headline and warm tungsten accents.",
    fonts: { heading: "Playfair Display", body: "Inter" }, palette: pal("#C99566", "#8A5A33", "#E8B97A", "#0A0A0B", "#F4EBDD", "#B8AFA2"), background: lin(180, "#1F1C1A", "#0A0A0B"),
    headline: { sizePct: [11, 13.5], weight: 400, tracking: -0.005, lineHeight: 1.08, case: "none", align: "center" }, body: { weight: 400, lineHeight: 1.3, case: "none", align: "center" },
    device: { rotation: 0, shadow: shadow(0, 30, 60, "rgba(0,0,0,0.6)"), frameStyle: "solid" } },
  { id: "paper-sticker-skeuomorphic", name: "Paper Sticker", description: "A mint corkboard with hand-lettered marker headlines in deep navy and sticker-bright accents.",
    fonts: { heading: "Permanent Marker", body: "Nunito" }, palette: pal("#3E8FD6", "#8FBE7C", "#F25C8E", "#F8F0E2", "#1F2A44", "#2B3A55"), background: { color: "#8FBE7C" },
    headline: { sizePct: [10.6, 12.1], weight: 400, tracking: -0.01, lineHeight: 1, case: "none", align: "center" }, body: { weight: 600, lineHeight: 1.3, case: "none", align: "center" },
    device: { rotation: 2, shadow: shadow(6, 18, 24, "rgba(60,40,20,0.30)"), frameStyle: "solid" } },
  { id: "dreamy-pastel-couples", name: "Dreamy Pastel", description: "A soft sky-to-peach wash with centred navy headlines and lilac accents.",
    fonts: { heading: "Inter", body: "Inter" }, palette: pal("#9B87E8", "#F3B6CC", "#DDEBFA", "#F5E0F0", "#1B2240", "#5D6380"), background: lin(180, "#DDEBFA", "#FCEFD6"),
    headline: { sizePct: [8, 9.5], weight: 600, tracking: -0.01, lineHeight: 1.05, case: "none", align: "center" }, body: { weight: 500, lineHeight: 1.4, case: "none", align: "center" },
    device: { rotation: 0, shadow: shadow(0, 20, 40, "rgba(27,34,64,0.18)"), frameStyle: "solid" } },
  { id: "hand-drawn-editorial-tasks", name: "Editorial Tasks", description: "Flat deep-navy slides, confident medium sans headlines, coral accents and boldly tilted phones.",
    fonts: { heading: "Inter", body: "Inter" }, palette: pal("#F26A50", "#7B61FF", "#F5EFDF", "#0E1018", "#FFFFFF", "#B8C0D3"), background: { color: "#1B2336" },
    headline: { sizePct: [7.5, 9.5], weight: 500, tracking: -0.01, lineHeight: 1.1, case: "none", align: "left" }, body: { weight: 400, lineHeight: 1.35, case: "none", align: "left" },
    device: { rotation: 12, shadow: shadow(0, 36, 60, "rgba(184,86,64,0.30)"), frameStyle: "solid" } },
  { id: "glossy-3d-kbeauty-creator", name: "Glossy K-Beauty", description: "Saturated violet grounds, heavy white headlines and sunny yellow highlights.",
    fonts: { heading: "Inter", body: "Inter" }, palette: pal("#FBE254", "#7B3FE4", "#FFE16B", "#2A1B4A", "#FFFFFF", "#E9E1FF"), background: lin(180, "#7B3FE4", "#3B1C7A"),
    headline: { sizePct: [8, 10], weight: 900, tracking: -0.02, lineHeight: 1, case: "none", align: "center" }, body: { weight: 600, lineHeight: 1.25, case: "none", align: "center" },
    device: { rotation: 0, shadow: shadow(0, 24, 48, "rgba(40,10,80,0.45)"), frameStyle: "solid" } },
  { id: "liquid-glass-aurora", name: "Liquid Glass Aurora", description: "Pale lavender-to-apricot aurora light behind crisp, tightly tracked ink headlines.",
    fonts: { heading: "Inter Tight", body: "Inter Tight" }, palette: pal("#CDBBFF", "#AFD5FF", "#F7ECF3", "#F4F1FB", "#16131F", "#4A4660"), background: lin(160, "#EFE9FD", "#FDEBDF"),
    headline: { sizePct: [11.4, 13.3], weight: 700, tracking: -0.032, lineHeight: 0.98, case: "none", align: "center" }, body: { weight: 500, lineHeight: 1.28, case: "none", align: "center" },
    device: { rotation: 0, shadow: shadow(0, 40, 80, "rgba(90,60,180,0.25)"), frameStyle: "solid" } },
  { id: "swiss-grid-bold", name: "Swiss Grid Bold", description: "Off-white paper, giant flush-left heavy grotesk, upright phones and one orange signal.",
    fonts: { heading: "Inter Tight", body: "Inter Tight" }, palette: pal("#FF4F00", "#0E0E0C", "#F2F1EC", "#F2F1EC", "#0E0E0C", "#5E5D57"), background: { color: "#F2F1EC" },
    headline: { sizePct: [12.1, 14.4], weight: 800, tracking: -0.045, lineHeight: 0.9, case: "none", align: "left" }, body: { weight: 500, lineHeight: 1.15, case: "none", align: "left" },
    device: { rotation: 0, shadow: shadow(0, 22, 34, "rgba(14,14,12,0.14)"), frameStyle: "solid" } },
  { id: "neon-athletic-night", name: "Neon Athletic Night", description: "Stadium-night black, huge condensed uppercase headlines, one electric volt accent and tilted phones.",
    fonts: { heading: "Anton", body: "Barlow" }, palette: pal("#D4FF3A", "#A3A8AF", "#FF6A1A", "#0A0B0D", "#F4F5F0", "#A3A8AF"), background: lin(180, "#17191D", "#0A0B0D"),
    headline: { sizePct: [17.4, 22], weight: 400, tracking: -0.005, lineHeight: 0.88, case: "upper", align: "left" }, body: { weight: 500, lineHeight: 1.3, case: "none", align: "left" },
    device: { rotation: 8, shadow: shadow(0, 30, 60, "rgba(0,0,0,0.6)"), frameStyle: "solid" } },
  { id: "magazine-cover-editorial", name: "Magazine Cover", description: "Uncoated-paper grounds, a big high-contrast serif cover line and an oxblood accent.",
    fonts: { heading: "Fraunces", body: "Fraunces" }, palette: pal("#7A2320", "#2F4A3A", "#5E1917", "#F1EBE1", "#1A1714", "#4A423A"), background: { color: "#F1EBE1" },
    headline: { sizePct: [15.2, 16.3], weight: 400, tracking: -0.02, lineHeight: 1, case: "none", align: "left" }, body: { weight: 400, lineHeight: 1.2, case: "none", align: "left" },
    device: { rotation: 0, shadow: shadow(0, 28, 50, "rgba(122,35,32,0.22)"), frameStyle: "solid" } },
  { id: "candy-pop-social", name: "Candy Pop", description: "One loud flat colour per slide, chunky lowercase display type and hard offset shadows.",
    fonts: { heading: "Bricolage Grotesque", body: "Rubik" }, palette: pal("#FF5FA8", "#2B44F0", "#C6F135", "#FFFFFF", "#16121F", "#16121F"), background: { color: "#FF5FA8" },
    headline: { sizePct: [15.2, 18.2], weight: 800, tracking: -0.035, lineHeight: 0.9, case: "lower", align: "left" }, body: { weight: 700, lineHeight: 1.18, case: "none", align: "left" },
    device: { rotation: 6, shadow: shadow(18, 18, 0, "#D63D86"), frameStyle: "solid" } },
  { id: "soft-clay-wellness", name: "Soft Clay Wellness", description: "Warm oat grounds, a soft serif headline and terracotta clay accents for calm, tactile apps.",
    fonts: { heading: "Fraunces", body: "DM Sans" }, palette: pal("#C7765A", "#A9B79C", "#9A4B31", "#EFE7DA", "#3A2E26", "#6B5E52"), background: lin(180, "#F6F0E6", "#E6DACA"),
    headline: { sizePct: [12.1, 14.4], weight: 400, tracking: -0.025, lineHeight: 1, case: "none", align: "left" }, body: { weight: 400, lineHeight: 1.3, case: "none", align: "left" },
    device: { rotation: 0, shadow: shadow(0, 30, 60, "rgba(148,73,47,0.22)"), frameStyle: "solid" } },
  { id: "midnight-glow-pro", name: "Midnight Glow Pro", description: "A deep blue-black void, semibold tight headlines and a soft violet glow behind the phone.",
    fonts: { heading: "Inter Tight", body: "Inter" }, palette: pal("#8B7CFF", "#B4B9C6", "#5EE6FF", "#07080B", "#F4F5F8", "#B4B9C6"), background: lin(180, "#0B0D13", "#050608"),
    headline: { sizePct: [10.6, 12.1], weight: 600, tracking: -0.03, lineHeight: 1, case: "none", align: "center" }, body: { weight: 400, lineHeight: 1.35, case: "none", align: "center" },
    device: { rotation: 0, shadow: shadow(0, 40, 90, "rgba(120,110,255,0.30)"), frameStyle: "solid" } },
  { id: "risograph-zine", name: "Risograph Zine", description: "Newsprint paper, condensed uppercase headlines in riso blue and a fluorescent pink accent.",
    fonts: { heading: "Anton", body: "Archivo" }, palette: pal("#FF48B0", "#3255A4", "#FFE800", "#F4F0E6", "#3255A4", "#321871"), background: { color: "#F4F0E6" },
    headline: { sizePct: [18.2, 21.2], weight: 400, tracking: -0.005, lineHeight: 0.9, case: "upper", align: "left" }, body: { weight: 600, lineHeight: 1.18, case: "none", align: "left" },
    device: { rotation: -2, shadow: shadow(0, 16, 24, "rgba(50,24,113,0.30)"), frameStyle: "solid" } },
  { id: "bento-keynote-grid", name: "Bento Keynote", description: "A light keynote ground, clean bold sans headlines and one saturated brand accent.",
    fonts: { heading: "Inter Tight", body: "Inter" }, palette: pal("#B4441C", "#1D1D1F", "#F6EBE1", "#FFFFFF", "#1D1D1F", "#5E5E63"), background: { color: "#F5F5F7" },
    headline: { sizePct: [9.1, 10.6], weight: 700, tracking: -0.03, lineHeight: 1, case: "none", align: "left" }, body: { weight: 500, lineHeight: 1.3, case: "none", align: "left" },
    device: { rotation: 0, shadow: shadow(0, 24, 48, "rgba(0,0,0,0.12)"), frameStyle: "solid" } },
  { id: "toybox-primary", name: "Toybox Primary", description: "Warm cream with rounded chunky headlines in deep ink and bright primary toy colours.",
    fonts: { heading: "Baloo 2", body: "Nunito" }, palette: pal("#FF4B3E", "#3FA9F5", "#FFC940", "#FFF6E6", "#1F1A4D", "#5B5480"), background: { color: "#FFF6E6" },
    headline: { sizePct: [12.1, 14.4], weight: 800, tracking: -0.02, lineHeight: 0.95, case: "none", align: "center" }, body: { weight: 800, lineHeight: 1.2, case: "none", align: "center" },
    device: { rotation: 5, shadow: shadow(0, 20, 0, "rgba(31,26,77,0.35)"), frameStyle: "solid" } },
  { id: "quiet-japandi", name: "Quiet Japandi", description: "Washi-paper calm, a refined mincho headline and natural oak accents with plenty of air.",
    fonts: { heading: "Shippori Mincho", body: "Zen Kaku Gothic New" }, palette: pal("#C9A97E", "#7A5A34", "#E9D6B4", "#F3F0EA", "#1E1D1B", "#4E4B46"), background: lin(180, "#FCFAF6", "#E2DBCF"),
    headline: { sizePct: [11.5, 12.5], weight: 500, tracking: -0.012, lineHeight: 1.05, case: "none", align: "left" }, body: { weight: 400, lineHeight: 1.35, case: "none", align: "left" },
    device: { rotation: 0, shadow: shadow(0, 18, 40, "rgba(30,29,27,0.12)"), frameStyle: "solid" } },
  { id: "vintage-travel-poster", name: "Vintage Travel Poster", description: "Dusk-plum poster bands, tall uppercase display headlines in cream and mustard accents.",
    fonts: { heading: "Bebas Neue", body: "Zilla Slab" }, palette: pal("#D9622B", "#E8B04A", "#1F5C5B", "#4B2E4F", "#F1E4C8", "#F2CF8C"), background: { color: "#4B2E4F" },
    headline: { sizePct: [21.2, 24.2], weight: 400, tracking: 0.01, lineHeight: 0.9, case: "upper", align: "center" }, body: { weight: 700, lineHeight: 1.2, case: "upper", align: "center" },
    device: { rotation: 0, shadow: shadow(0, 24, 40, "rgba(28,26,23,0.4)"), frameStyle: "solid" } },
];

export const getStyle = (id: string) => STYLES.find((s) => s.id === id);

/** Every field applyStyle may write; nothing else is ever touched. */
export const STYLE_FIELDS = {
  board: ["backgroundType", "backgroundColor", "backgroundGradient"],
  text: ["fontFamily", "fontWeight", "fontSize", "color", "letterSpacing", "lineHeight", "textTransform", "textAlign", "gradient"],
  device: ["rotation", "shadow", "frameStyle"],
};

const CASE: Record<TextCase, "uppercase" | "lowercase" | undefined> = { none: undefined, upper: "uppercase", lower: "lowercase" };
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Writes only what differs (undefined deletes), so re-applying a style changes nothing and adds no undo step. */
function put(o: Record<string, unknown>, k: string, v: unknown) {
  if (v === undefined) { if (k in o) delete o[k]; return; }
  if (JSON.stringify(o[k]) !== JSON.stringify(v)) o[k] = typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
}

/**
 * Applies a named style to every board of a group: background, text fonts/colours/weights/tracking/line
 * height/case/alignment, device rotation/shadow/frame. Never content, marks, sources or translations.
 * The headline is each board's top-most text (smallest y), so the choice never depends on a previous style.
 */
export function applyStyle(doc: ChitrapxDoc, groupId: string, styleId: string): ChitrapxDoc {
  const style = getStyle(styleId);
  if (!style || !doc.groups.find((g) => g.id === groupId)?.boards.length) return doc;
  return produce(doc, (d) => {
    const g = d.groups.find((x) => x.id === groupId)!;
    if (g.styleId !== style.id) g.styleId = style.id;
    for (const b of g.boards) {
      const board = b as unknown as Record<string, unknown>;
      if ("gradient" in style.background) {
        const { stops, angle } = style.background.gradient;
        put(board, "backgroundType", "gradient");
        put(board, "backgroundColor", stops[0]!.color);
        put(board, "backgroundGradient", { color1: stops[0]!.color, color2: stops.at(-1)!.color, angle: angle ?? 180 });
      } else {
        put(board, "backgroundType", "solid");
        put(board, "backgroundColor", style.background.color);
        put(board, "backgroundGradient", undefined);
      }
      const texts = b.elements.filter((e) => e.type === "text");
      const headline = texts.reduce<(typeof texts)[number] | undefined>((best, e) => (!best || e.position.y < best.position.y ? e : best), undefined);
      for (const t of texts) {
        const o = t as unknown as Record<string, unknown>;
        const isHead = t === headline;
        const rules = isHead ? style.headline : style.body;
        put(o, "fontFamily", isHead ? style.fonts.heading : style.fonts.body);
        put(o, "fontWeight", String(rules.weight));
        put(o, "color", isHead ? style.palette.text : style.palette.muted);
        put(o, "lineHeight", rules.lineHeight);
        put(o, "textTransform", CASE[rules.case]);
        put(o, "textAlign", rules.align);
        put(o, "gradient", undefined);
        if (isHead) {
          const [lo, hi] = style.headline.sizePct;
          const fontSize = round2(((b.size.width * (lo + hi)) / 2 / 100) * 0.3); // rendered px = fontSize / 0.3
          put(o, "fontSize", fontSize);
          put(o, "letterSpacing", style.headline.tracking ? round2(style.headline.tracking * fontSize) : undefined); // tracking em, in fontSize units
        }
      }
      for (const e of b.elements) {
        if (e.type !== "device" && e.type !== "video-device") continue;
        const o = e as unknown as Record<string, unknown>;
        put(o, "rotation", style.device.rotation);
        put(o, "shadow", style.device.shadow ?? undefined);
        put(o, "frameStyle", style.device.frameStyle);
      }
    }
  });
}
```

Add `export * from "./styles.ts";` to the index. In `artboard.ts`, add to `TextElementProps`, after `gradient`:

```ts
  // SP10: drawn with CSS text-transform, so content and mark offsets are untouched.
  textTransform?: 'uppercase' | 'lowercase';
```

The test expects the Swiss headline at `1290 * 0.1325 * 0.3`: the `sizePct` midpoint is (12.1 + 14.4) / 2 = 13.25.

- [ ] **Step 3: Renderer case, command, picker**

- In `TextElement.tsx`'s style object, add `textTransform: element.textTransform,`.
- In `textFit.ts`, add `'textTransform'` to the `Pick` and `node.style.textTransform = element.textTransform || 'none';`.
- Export `fitTextBox` from `packages/renderer/src/index.ts`: `export { fitTextBox } from "./osg/lib/textFit";`.

In `commands.ts`:
- Import `applyStyle` from `@chitrapx/document`.
- Add `| { type: "applyStyle"; groupId: string; styleId: string; fits?: Record<string, { size: { width: number; height: number }; position: { x: number; y: number } }> }` to `Command`.
- At the top of `applyCommand`, next to `setTexts`, add:

```ts
  if (cmd.type === "applyStyle") {
    const styled = applyStyle(doc, cmd.groupId, cmd.styleId);
    if (styled === doc || !cmd.fits || !Object.keys(cmd.fits).length) return styled;
    // Boxes the new type no longer fits grow in the same step (measured by the caller after the fonts loaded).
    return produce(styled, (d) => {
      for (const b of d.groups.find((g) => g.id === cmd.groupId)?.boards ?? []) for (const e of b.elements) {
        const fit = cmd.fits![`${b.id}:${e.id}`];
        if (!fit) continue;
        if (e.size.width !== fit.size.width || e.size.height !== fit.size.height) e.size = fit.size;
        if (e.position.x !== fit.position.x || e.position.y !== fit.position.y) e.position = fit.position;
      }
    });
  }
```

`apps/web/src/editor/ui/StylePicker.tsx`:

```tsx
"use client";

import { useState } from "react";
import { applyStyle, BRAND_TOKENS, STYLES, type TextElementProps } from "@chitrapx/document";
import { ensureFont, fitTextBox } from "@chitrapx/renderer";
import { api } from "@/server/api.ts";
import { useEditorAssets } from "../assets.tsx";
import { useEditor, useEditorStore } from "../context.tsx";

/** 18 named looks; one click restyles every board of the active size as one undo step. */
export function StylePicker() {
  const store = useEditorStore();
  const groupId = useEditor((s) => s.activeGroupId);
  const current = useEditor((s) => s.doc.groups.find((g) => g.id === s.activeGroupId)?.styleId);
  const { appId } = useEditorAssets();
  const [savePalette, setSavePalette] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function pick(id: string) {
    const style = STYLES.find((s) => s.id === id)!;
    const doc = store.getState().doc;
    if (!doc.groups.find((g) => g.id === groupId)?.boards.length) { setNotice("Add a board to this size first"); return; }
    setBusy(true); setNotice("");
    try {
      // Measure with the style's real faces, or the boxes would be sized for a fallback.
      await Promise.all([ensureFont(style.fonts.heading, style.headline.weight), ensureFont(style.fonts.body, style.body.weight)]);
      const styled = applyStyle(doc, groupId, id);
      const fits: Record<string, NonNullable<ReturnType<typeof fitTextBox>>> = {};
      for (const b of styled.groups.find((g) => g.id === groupId)!.boards) {
        for (const e of b.elements) {
          if (e.type !== "text") continue;
          const fit = fitTextBox(e as TextElementProps, (e as TextElementProps).content);
          if (fit) fits[`${b.id}:${e.id}`] = fit;
        }
      }
      store.getState().apply({ type: "applyStyle", groupId, styleId: id, fits });
      if (savePalette) await api(`/api/apps/${appId}`, "PATCH", { brand: { palette: BRAND_TOKENS.map((t) => ({ token: t, color: style.palette[t] })) } });
    } catch (err) { setNotice((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <section className="space-y-2">
      <h2 className="label">Style</h2>
      <div className="grid grid-cols-3 gap-1.5">
        {STYLES.map((s) => (
          <button key={s.id} type="button" disabled={busy} onClick={() => pick(s.id)} title={s.description} aria-pressed={current === s.id}
            className={`overflow-hidden rounded border text-left ${current === s.id ? "border-indigo-500 ring-2 ring-indigo-500/40" : "border-neutral-300 dark:border-neutral-700"}`}>
            <img src={`/styles/${s.id}.png`} alt="" className="aspect-[9/19.5] w-full object-cover" loading="lazy" />
            <span className="block truncate px-1 py-0.5 text-[10px]">{s.name}</span>
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={savePalette} onChange={(e) => setSavePalette(e.target.checked)} /> Also save as my brand palette
      </label>
      {notice && <p role="status" className="text-xs text-amber-700">{notice}</p>}
    </section>
  );
}
```

In `LeftPanel.tsx`, import `StylePicker` and render `<StylePicker />` above `<Checks />`. In `Inspector.tsx`'s text section, add this after the alignment buttons:

```tsx
          <SelectField id="i-case" label="Case" value={a.textTransform ?? "none"} options={[["none", "As typed"], ["uppercase", "UPPERCASE"], ["lowercase", "lowercase"]] as const}
            onChange={(v) => set({ textTransform: v === "none" ? undefined : v })} />
```

Add `textTransform?: "uppercase" | "lowercase"` to the inspector's local `AnyFields` type if it is not picked up from `TextElementProps`.

Append to the app-store-screenshots row in `NOTICES.md`: `; the 18 named styles' names and numeric values (`packages/document/src/styles.ts`, from `skills/app-store-screenshots/style-prompts/01–18`; descriptions written fresh)`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @chitrapx/document test && pnpm --filter @chitrapx/renderer test && pnpm --filter @chitrapx/web exec vitest run test/commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Generate the previews through the real renderer**

This uses the e2e golden path: a project, a pinned `export_single` job and `runExport` through the web render page. Add `"scripts"` to `include` in `apps/worker/tsconfig.json`.

`apps/worker/scripts/gen-style-previews.ts`:

```ts
// Renders one fixed sample board in each named style through the real export path and writes
// apps/web/public/styles/<id>.png at 240 px wide. Needs what the e2e suite needs: local Supabase,
// MinIO and the web dev server at WEB_ORIGIN.
// Run: pnpm --filter @chitrapx/worker exec tsx --env-file=../../.env scripts/gen-style-previews.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { db, schema } from "@chitrapx/db";
import { applyStyle, STYLES, type ChitrapxDoc } from "@chitrapx/document";
import { EXPORTS_BUCKET } from "@chitrapx/storage";
import { createUser, makeWorkspace } from "../../../packages/db/test/helpers.ts";
import { runExport } from "../src/export.ts";
import { runJob } from "../src/runJob.ts";
import { storage } from "../src/storage.ts";

const OUT = join(import.meta.dirname, "../../web/public/styles");
const SAMPLE = {
  schemaVersion: 1, kind: "screenshots", localization: { baseLocale: "en-US", locales: [] },
  groups: [{ id: "g", target: "iphone-6.9", spanElements: [], boards: [{ id: "b", name: "Sample", position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, backgroundColor: "#ffffff", zoom: 1, elements: [
    { id: "h", type: "text", content: "Track habits.\nKeep streaks.", fontSize: 40, color: "#000000", fontFamily: "Inter", fontWeight: "700", textAlign: "center", lineHeight: 1.1, position: { x: 95, y: 170 }, size: { width: 1100, height: 560 }, rotation: 0, scale: 1 },
    { id: "s", type: "text", content: "Your day, one tap at a time", fontSize: 14, color: "#333333", fontFamily: "Inter", fontWeight: "400", textAlign: "center", position: { x: 145, y: 740 }, size: { width: 1000, height: 120 }, rotation: 0, scale: 1 },
    { id: "d", type: "device", deviceType: "iphone-17-pro-max", styleType: "normal", position: { x: 245, y: 920 }, size: { width: 800, height: 1740 }, rotation: 0, scale: 1 },
  ] }] }],
} as unknown as ChitrapxDoc;

const ws = await makeWorkspace((await createUser()).id);
const [app] = await db.insert(schema.apps).values({ workspaceId: ws, name: "Style previews" }).returning();
mkdirSync(OUT, { recursive: true });
for (const style of STYLES) {
  const doc = applyStyle(SAMPLE, "g", style.id);
  const [p] = await db.insert(schema.projects).values({ workspaceId: ws, appId: app!.id, name: style.name, kind: "screenshots", doc }).returning();
  const [v] = await db.insert(schema.projectVersions).values({ workspaceId: ws, projectId: p!.id, revision: 0, doc }).returning();
  const [job] = await db.insert(schema.jobs).values({ workspaceId: ws, projectId: p!.id, type: "export_single", creditsReserved: 0,
    input: { versionId: v!.id, selection: { targets: ["iphone-6.9"], locales: ["en-US"], board: { groupId: "g", boardIndex: 0 } } } }).returning();
  await runJob(job!.id, (input, ctx) => runExport(input, ctx, "single"));
  const png = await storage().download(`${ws}/${job!.id}.png`, EXPORTS_BUCKET);
  writeFileSync(join(OUT, `${style.id}.png`), await sharp(png).resize({ width: 240 }).png().toBuffer());
  console.log(`wrote ${style.id}.png`);
}
process.exit(0);
```

Start the web server with the dev-server commands in Global Constraints, run the command in the header, and stop the server by PID.
Expected: 18 `wrote …` lines, and 18 PNGs in `apps/web/public/styles/`. Open a few:
- `swiss-grid-bold.png` has a flush-left heavy black headline on off-white.
- `neon-athletic-night.png` has an uppercase condensed headline on near-black and a tilted phone.
- `vintage-travel-poster.png` has cream uppercase text on plum.

- [ ] **Step 6: Browser check**

Start the web dev server with the dev-server commands in Global Constraints.
- Click "Swiss Grid Bold": every board of the size changes background, fonts and text colours. One undo restores everything.
- Click it again: no new undo step.
- Click "Quiet Japandi": no Swiss values are left (no tracking, solid background gone, mincho headline).
- Tick "Also save as my brand palette" and apply a style. The brand form on the app page shows the style's six colours.

Stop the server by PID.

- [ ] **Step 7: Full verification and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`, then the e2e suite, using the dev-server commands in Global Constraints.
Expected:
- All pass. The only typecheck error is `billing.ts:61`.
- These goldens are new: `custom-font-woff2.png`, `rich-text-gradient.png` and `carplay.png`.
- The amoura goldens changed only in Task 4. Every other golden is unchanged.

```bash
git add packages apps/web apps/worker NOTICES.md
git commit -m "feat(styles): 18 one-click named styles with previews, text case, and optional brand palette save"
```

---

## Manual browser checks (after all tasks; magic-link login blocks automation)

1. **Storage:**
   - Upload a screenshot and a recording.
   - Import a `.chitrapx` file.
   - Download an export ZIP.
   - The MinIO console (http://127.0.0.1:9001) shows only `staging/…` keys before completion and `<ws>/<sha>` after it.
2. **Fonts:**
   - The editor makes no Google request on load.
   - Picker previews load as you scroll.
   - An uploaded `.woff2` renders on the canvas and in an exported PNG.
   - Deleting it while it is in use is refused, and the projects using it are listed.
3. **Rich text:**
   - Bold plus a gradient on two words is one undo each.
   - Typing before them keeps the styling on them.
   - A translation shows the "reapply" note.
4. **Brand:**
   - Extracting from screenshots gives the same swatches each time.
   - A brand swatch on a text recolours it when the palette changes.
   - Text on Surface below 4.5:1 warns.
5. **Formulas:** with no text selected, the panel says "Select a headline first". A leftover `[verb]` appears in Checks.
6. **CarPlay:** it is in the Vehicle group. Switching a phone to CarPlay makes a centred landscape frame. The export lands in the iPhone 6.9" folder.
7. **Styles:** all 18 previews show. Applying one is one undo step. Applying it twice adds nothing.
