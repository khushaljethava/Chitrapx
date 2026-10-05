import { requireContext } from "@/server/context.ts";
import { readJsonLimited, route } from "@/server/http.ts";
import { listVersions, saveNamedVersion } from "@/server/versions.ts";

type P = { params: Promise<{ projectId: string }> };
export const GET = route(async (_req: Request, { params }: P) => listVersions(await requireContext(), (await params).projectId));
export const POST = route(async (req: Request, { params }: P) =>
  Response.json(await saveNamedVersion(await requireContext(), (await params).projectId, await readJsonLimited(req, 4096, "Request too large")), { status: 201 }));
