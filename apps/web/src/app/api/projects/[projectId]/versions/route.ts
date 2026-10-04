import { requireContext } from "@/server/context.ts";
import { readJson, route } from "@/server/http.ts";
import { listVersions, saveNamedVersion } from "@/server/versions.ts";

type P = { params: Promise<{ projectId: string }> };
export const GET = route(async (_req: Request, { params }: P) => listVersions(await requireContext(), (await params).projectId));
export const POST = route(async (req: Request, { params }: P) =>
  Response.json(await saveNamedVersion(await requireContext(), (await params).projectId, await readJson(req)), { status: 201 }));
