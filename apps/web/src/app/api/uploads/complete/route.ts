import { requireContext } from "@/server/context.ts";
import { readJson, route } from "@/server/http.ts";
import { supabaseStorage } from "@/server/storage.ts";
import { completeUpload } from "@/server/uploads.ts";

export const POST = route(async (req: Request) => {
  const ctx = await requireContext();
  return completeUpload(ctx, supabaseStorage(), await readJson(req));
});
