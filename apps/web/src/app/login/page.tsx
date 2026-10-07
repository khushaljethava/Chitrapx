"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/browser.ts";

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState(params.get("error") ? "Sign-in failed. Try again." : "");
  const next = params.get("next") ?? "/dashboard";
  const redirectTo = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const supabase = createClient();

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError("");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo() } });
    if (error) { setError(error.message); setState("idle"); } else setState("sent");
  }

  async function oauth(provider: "google" | "github") {
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo() } });
    if (error) setError(error.message);
  }

  if (state === "sent") {
    return <p className="text-center text-sm">Check <strong>{email}</strong> for your sign-in link.</p>;
  }
  return (
    <div className="space-y-4">
      <form onSubmit={sendLink} className="space-y-3">
        <label className="label" htmlFor="email">Email</label>
        <input id="email" type="email" required autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn w-full" disabled={state === "sending"}>{state === "sending" ? "Sending" : "Email me a sign-in link"}</button>
      </form>
      <div className="flex items-center gap-3 text-xs text-neutral-500"><span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />or<span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" /></div>
      <button type="button" className="btn-ghost w-full" onClick={() => oauth("google")}>Continue with Google</button>
      <button type="button" className="btn-ghost w-full" onClick={() => oauth("github")}>Continue with GitHub</button>
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <aside aria-hidden className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <span className="font-display text-lg font-bold">Chitrapx</span>
        <div className="flex justify-center gap-4">
          {["-rotate-6 translate-y-8", "z-10", "rotate-6 translate-y-8"].map((t) => (
            <div key={t} className={`aspect-[9/19] w-36 rounded-[1.75rem] border border-white/25 bg-white/10 p-2 shadow-2xl backdrop-blur ${t}`}>
              <div className="h-full rounded-[1.25rem] bg-gradient-to-b from-white/30 to-white/5" />
            </div>
          ))}
        </div>
        <p className="max-w-sm font-display text-2xl font-semibold leading-snug">From raw app screens to a store-ready set in one sitting.</p>
      </aside>
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-3xl font-bold">Sign in to Chitrapx</h1>
          <p className="mb-8 mt-2 text-sm text-neutral-500">No password needed. We&apos;ll email you a link.</p>
          <Suspense><LoginForm /></Suspense>
        </div>
      </div>
    </main>
  );
}
