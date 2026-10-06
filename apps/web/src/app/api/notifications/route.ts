import { requireContext } from "@/server/context.ts";
import { readJsonLimited, route } from "@/server/http.ts";
import { listNotifications, markRead } from "@/server/notifications.ts";

/** GET: the latest 20 and the unread count. POST { ids? }: mark some (or all) of your own read. */
export const GET = route(async () => Response.json(await listNotifications(await requireContext()), { headers: { "Cache-Control": "no-store" } }));
export const POST = route(async (req: Request) => {
  await markRead(await requireContext(), await readJsonLimited(req, 8192, "Request too large").catch(() => ({})));
});
