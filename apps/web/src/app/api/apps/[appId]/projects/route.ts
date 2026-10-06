import { requireContext } from "@/server/context.ts";
import { readJson, route } from "@/server/http.ts";
import { createProject, listProjects } from "@/server/projects.ts";

type P = { params: Promise<{ appId: string }> };

export const GET = route(async (_req: Request, { params }: P) => listProjects(await requireContext(), (await params).appId));
export const POST = route(async (req: Request, { params }: P) => {
  const ctx = await requireContext("edit");
  return Response.json(await createProject(ctx, (await params).appId, await readJson(req)), { status: 201 });
});
