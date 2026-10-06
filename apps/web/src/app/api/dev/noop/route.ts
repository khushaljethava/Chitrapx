import { z } from "zod";
import { getBoss } from "@/server/boss.ts";
import { requireContext } from "@/server/context.ts";
import { devToolsEnabled } from "@/server/devTools.ts";
import { notFound, readJson, route } from "@/server/http.ts";
import { enqueueNoop } from "@/server/jobs.ts";

export const POST = route(async (req: Request) => {
  if (!devToolsEnabled()) throw notFound();
  const ctx = await requireContext("spend");
  const { fail } = z.object({ fail: z.boolean().default(false) }).parse(await readJson(req));
  return Response.json(await enqueueNoop(ctx, await getBoss(), { fail }), { status: 201 });
});
