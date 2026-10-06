import { getBoss } from "@/server/boss.ts";
import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { enqueueImport } from "@/server/imports.ts";

export const POST = route(async (req: Request, { params }: { params: Promise<{ appId: string }> }) =>
  Response.json(await enqueueImport(await requireContext("spend"), await getBoss(), (await params).appId, await req.json().catch(() => ({}))), { status: 201 }));
