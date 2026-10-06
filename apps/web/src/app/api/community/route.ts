import { listPosts, publishPost } from "@/server/community.ts";
import { requireContext } from "@/server/context.ts";
import { readJsonLimited, route } from "@/server/http.ts";
import { appStorage } from "@/server/storage.ts";

/** The community feed: ?platform=&category=&sort=new|popular&page= */
export const GET = route(async (req: Request) => {
  const q = Object.fromEntries(new URL(req.url).searchParams);
  return listPosts(await requireContext(), appStorage(), q);
});

/** Share a project: { projectId, title, description, category, license: true } */
export const POST = route(async (req: Request) =>
  Response.json(await publishPost(await requireContext("share"), appStorage(), await readJsonLimited(req, 4096, "Request too large")), { status: 201 }));
