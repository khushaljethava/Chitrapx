import { cancelSubscription } from "@/server/billing.ts";
import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";

export const POST = route(async () => cancelSubscription(await requireContext("billing")));
