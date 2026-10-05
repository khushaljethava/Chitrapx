import { NextResponse, type NextRequest } from "next/server";
import { ensureWorkspace } from "@chitrapx/db";
import { createClient } from "@/lib/supabase/server.ts";
import { safeNext } from "@/server/safeNext.ts";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      const meta = data.user.user_metadata ?? {};
      const { created } = await ensureWorkspace({ id: data.user.id, email: data.user.email ?? "", name: meta.full_name ?? meta.name, avatarUrl: meta.avatar_url });
      // A brand-new account: the dashboard counts one anonymous sign_up, if the visitor allowed counting.
      // Kept as string concatenation on purpose: resolving `next` with new URL() could turn a crafted path into another host.
      const [path, hash] = safeNext(searchParams.get("next")).split("#", 2);
      const welcome = created ? `${path!.includes("?") ? "&" : "?"}welcome=1` : "";
      return NextResponse.redirect(`${origin}${path}${welcome}${hash !== undefined ? `#${hash}` : ""}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
