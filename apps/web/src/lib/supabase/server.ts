import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env.ts";

export async function createClient() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // Server Components cannot set cookies; proxy.ts refreshes the session instead.
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* read-only */ }
      },
    },
  });
}
