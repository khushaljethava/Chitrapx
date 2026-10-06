import { deleteComment, updateComment } from "@/server/comments.ts";
import { requireContext } from "@/server/context.ts";
import { readJsonLimited, route } from "@/server/http.ts";

type P = { params: Promise<{ projectId: string; commentId: string }> };

/** PATCH { body } (author only) or { resolved } (thread root). DELETE: author, admin or owner. */
export const PATCH = route(async (req: Request, { params }: P) => {
  const ctx = await requireContext("comment");
  const { projectId, commentId } = await params;
  return updateComment(ctx, projectId, commentId, await readJsonLimited(req, 16_384, "Comment too long"));
});
export const DELETE = route(async (_req: Request, { params }: P) => {
  const { projectId, commentId } = await params;
  await deleteComment(await requireContext("comment"), projectId, commentId);
});
