import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { appStorage } from "@/server/storage.ts";
import { listReferences } from "@/server/uploads.ts";

type P = { params: Promise<{ appId: string }> };

export const GET = route(async (_req: Request, { params }: P) => listReferences(await requireContext(), appStorage(), (await params).appId));
