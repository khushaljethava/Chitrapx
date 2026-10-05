import { getBoss } from "@/server/boss.ts";
import { requireContext } from "@/server/context.ts";
import { queueRecordingProcessing } from "@/server/jobs.ts";
import { readJson, route } from "@/server/http.ts";
import { appStorage } from "@/server/storage.ts";
import { signUpload } from "@/server/uploads.ts";

export const POST = route(async (req: Request) => {
  const ctx = await requireContext();
  const signed = await signUpload(ctx, appStorage(), await readJson(req));
  // A file already here may still need converting (it failed, or its first enqueue never happened).
  if ("existing" in signed) await queueRecordingProcessing(ctx, await getBoss(), signed.existing);
  return signed;
});
