import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { createSocialProject } from "@/server/projects.ts";

export const POST = route(async (_req: Request, { params }: { params: Promise<{ projectId: string }> }) =>
  Response.json(await createSocialProject(await requireContext("edit"), (await params).projectId), { status: 201 }));
