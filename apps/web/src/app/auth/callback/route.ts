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
      await ensureWorkspace({ id: data.user.id, email: data.user.email ?? "", name: meta.full_name ?? meta.name, avatarUrl: meta.avatar_url });
      return NextResponse.redirect(`${origin}${safeNext(searchParams.get("next"))}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
