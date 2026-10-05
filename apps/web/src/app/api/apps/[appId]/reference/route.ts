import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { appStorage } from "@/server/storage.ts";
import { listReferences } from "@/server/uploads.ts";
import { startReferenceAnalysis } from "@/server/ai.ts";
import { getBoss } from "@/server/boss.ts";

type P = { params: Promise<{ appId: string }> };

export const GET = route(async (_req: Request, { params }: P) => listReferences(await requireContext(), appStorage(), (await params).appId));

export const POST = route(async (_req: Request, { params }: P) =>
  Response.json(await startReferenceAnalysis(await requireContext(), await getBoss(), (await params).appId), { status: 201 }));
