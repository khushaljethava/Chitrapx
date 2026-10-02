import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env.ts";

/** Service-role client for Storage. Never import from client components. */
export const adminClient = () =>
  createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
