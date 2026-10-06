import { getBoss } from "@/server/boss.ts";
import { requireContext } from "@/server/context.ts";
import { readJson, route } from "@/server/http.ts";
import { queueRecordingProcessing } from "@/server/jobs.ts";
import { appStorage } from "@/server/storage.ts";
import { completeUpload } from "@/server/uploads.ts";

export const POST = route(async (req: Request) => {
  const ctx = await requireContext("edit");
  const asset = await completeUpload(ctx, appStorage(), await readJson(req));
  await queueRecordingProcessing(ctx, await getBoss(), asset);
  return asset;
});
