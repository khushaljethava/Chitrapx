import { brandPalette, docFontFamilies, type ChitrapxDoc } from "@chitrapx/document";
import type { RenderExtras } from "@chitrapx/renderer";
import { facesOf } from "@/lib/fontFaces.ts";
import { getApp } from "./apps.ts";
import type { Ctx } from "./context.ts";
import { listFonts } from "./fonts.ts";
import type { ObjectStorage } from "./storage.ts";

/** What every render surface needs beyond the document: the workspace's uploaded font faces (all, or only `doc`'s) and the app's brand palette. */
export async function renderExtras(ctx: Ctx, storage: ObjectStorage, opts: { doc?: ChitrapxDoc; appId?: string } = {}): Promise<RenderExtras> {
  const [fonts, app] = await Promise.all([listFonts(ctx, storage), opts.appId ? getApp(ctx, opts.appId) : null]);
  return { faces: facesOf(fonts, opts.doc ? new Set(docFontFamilies(opts.doc)) : undefined), palette: brandPalette(app?.brand) };
}
