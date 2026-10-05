import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { cspHeader } from "@/lib/csp.ts";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env.ts";

const CSP = cspHeader({ supabaseUrl: SUPABASE_URL ?? "", storageEndpoint: process.env.S3_ENDPOINT, dev: process.env.NODE_ENV === "development" });

/**
 * Refreshes the Supabase session cookie and keeps signed-out users out of /dashboard and /editor.
 * Every page also gets the Content-Security-Policy, report-only for now (see lib/csp.ts).
 */
export async function proxy(request: NextRequest) {
  const res = await handle(request);
  res.headers.set("Content-Security-Policy-Report-Only", CSP);
  return res;
}

async function handle(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();

  if (!user && (request.nextUrl.pathname.startsWith("/dashboard") || request.nextUrl.pathname.startsWith("/editor"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/version|api/events|api/billing/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
