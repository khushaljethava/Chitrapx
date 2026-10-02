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
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm">
        <h1 className="mb-6 text-xl font-semibold">Sign in to Chitrapx</h1>
        <Suspense><LoginForm /></Suspense>
      </div>
    </main>
  );
}
