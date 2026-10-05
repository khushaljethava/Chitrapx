import { deletePost, getPost } from "@/server/community.ts";
import { requireContext } from "@/server/context.ts";
import { route } from "@/server/http.ts";
import { isStaff } from "@/server/staff.ts";
import { appStorage } from "@/server/storage.ts";

type P = { params: Promise<{ postId: string }> };

/** 404 for a hidden post unless you wrote it (or are staff), and for a removed one always. */
export const GET = route(async (_req: Request, { params }: P) => getPost(await requireContext(), appStorage(), (await params).postId, await isStaff()));

/** The author deletes their post; copies others imported stay. */
export const DELETE = route(async (_req: Request, { params }: P) => {
  await deletePost(await requireContext(), appStorage(), (await params).postId);
});
