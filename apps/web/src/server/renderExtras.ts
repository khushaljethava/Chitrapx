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
