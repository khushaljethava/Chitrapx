import { createOrder } from "@/server/billing.ts";
import { requireContext } from "@/server/context.ts";
import { readJson, route } from "@/server/http.ts";

export const POST = route(async (req: Request) => createOrder(await requireContext("billing"), await readJson(req)));
