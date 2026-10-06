import { createComment, listComments } from "@/server/comments.ts";
import { requireContext } from "@/server/context.ts";
import { readJsonLimited, route } from "@/server/http.ts";

type P = { params: Promise<{ projectId: string }> };

/** GET: every thread (polled by the editor). POST { boardId, elementId?, xPct?, yPct?, body } or { parentId, body }. */
export const GET = route(async (_req: Request, { params }: P) =>
  Response.json({ threads: await listComments(await requireContext(), (await params).projectId) }, { headers: { "Cache-Control": "no-store" } }));
export const POST = route(async (req: Request, { params }: P) => {
  const ctx = await requireContext("comment");
  return Response.json(await createComment(ctx, (await params).projectId, await readJsonLimited(req, 16_384, "Comment too long")), { status: 201 });
});
