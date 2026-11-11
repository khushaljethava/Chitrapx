import { requireAdmin, setPlan } from "@/server/admin.ts";
import { readJson, route } from "@/server/http.ts";

export const POST = route(async (req: Request) => setPlan(await requireAdmin(), await readJson(req)));
