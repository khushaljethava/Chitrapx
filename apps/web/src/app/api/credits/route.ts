import { balance, db } from "@chitrapx/db";
import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";

export const GET = route(async () => ({ balance: await balance(db, (await requireContext()).workspaceId) }));
