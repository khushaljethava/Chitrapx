import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { signImport } from "@/server/imports.ts";
import { appStorage } from "@/server/storage.ts";

export const POST = route(async (req: Request, { params }: { params: Promise<{ appId: string }> }) =>
  signImport(await requireContext("spend"), appStorage(), (await params).appId, await req.json().catch(() => ({}))));
