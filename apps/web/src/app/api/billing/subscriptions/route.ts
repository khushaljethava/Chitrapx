import { createSubscription } from "@/server/billing.ts";
import { requireContext } from "@/server/context.ts";
import { readJson, route } from "@/server/http.ts";

export const POST = route(async (req: Request) => createSubscription(await requireContext(), await readJson(req)));
