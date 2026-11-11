import { adjustCredits, requireAdmin } from "@/server/admin.ts";
import { readJson, route } from "@/server/http.ts";

export const POST = route(async (req: Request) => adjustCredits(await requireAdmin(), await readJson(req)));
