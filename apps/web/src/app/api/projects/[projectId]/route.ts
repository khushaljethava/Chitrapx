import { requireContext } from "@/server/context.ts";
import { readJson, route } from "@/server/http.ts";
import { deleteProject, updateProject } from "@/server/projects.ts";

type P = { params: Promise<{ projectId: string }> };

export const PATCH = route(async (req: Request, { params }: P) => {
  const ctx = await requireContext();
  return updateProject(ctx, (await params).projectId, await readJson(req));
});
export const DELETE = route(async (_req: Request, { params }: P) => {
  await deleteProject(await requireContext(), (await params).projectId);
});
