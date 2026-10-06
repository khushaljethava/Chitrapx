import { authorize } from "@/server/authz.ts";
import { importPost, moderatePost, reportPost } from "@/server/community.ts";
import { requireContext } from "@/server/context.ts";
import { notFound, readJsonLimited, route } from "@/server/http.ts";
import { isStaff } from "@/server/staff.ts";
import { appStorage } from "@/server/storage.ts";

type P = { params: Promise<{ postId: string; action: string }> };

/**
 * POST /api/community/<id>/import   { appId }               a new project from the post
 * POST /api/community/<id>/report   { reason }              one report per user
 * POST /api/community/<id>/moderate { action, note? }       staff only (404 otherwise)
 */
export const POST = route(async (req: Request, { params }: P) => {
  const { postId, action } = await params;
  const ctx = await requireContext();
  const body = await readJsonLimited(req, 4096, "Request too large");
  // Importing creates a project in the workspace; reporting and staff moderation are per user.
  if (action === "import") authorize(ctx, "edit");
  if (action === "import") return Response.json(await importPost(ctx, appStorage(), postId, body), { status: 201 });
  if (action === "report") return reportPost(ctx, postId, body);
  if (action === "moderate") return moderatePost(ctx, await isStaff(), postId, body);
  throw notFound();
});
