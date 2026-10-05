import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { exportDownloadUrl } from "@/server/jobs.ts";
import { appStorage } from "@/server/storage.ts";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ jobId: string }> }) => {
  const url = await exportDownloadUrl(await requireContext(), appStorage(), (await params).jobId);
  return Response.redirect(url, 302);
});
