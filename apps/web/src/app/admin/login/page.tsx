"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/browser.ts";

/** Email, then the 6-digit code Supabase sends. Only existing accounts get a code; /admin itself checks ADMIN_EMAILS. */
export default function AdminLoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    setBusy(false);
    // An unknown email moves on like a known one, so the form does not reveal which emails have accounts.
    if (error && error.status === 429) setError("Too many codes requested. Wait a minute and try again.");
    else setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) { setError("That code is wrong or expired."); setBusy(false); return; }
    router.replace("/admin");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Chitrapx admin</h1>
          <p className="mt-2 text-sm text-neutral-500">
            {step === "email" ? "We'll email you a 6-digit sign-in code." : <>If <strong>{email}</strong> has an account, a code is on its way.</>}
          </p>
        </div>
        {step === "email" ? (
          <form onSubmit={sendCode} className="space-y-3">
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn w-full" disabled={busy}>{busy ? "Sending" : "Send code"}</button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-3">
            <label className="label" htmlFor="code">Code</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" required autoFocus className="input tracking-[0.3em]"
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            <button className="btn w-full" disabled={busy}>{busy ? "Checking" : "Sign in"}</button>
            <button type="button" className="btn-ghost w-full" onClick={() => { setStep("email"); setCode(""); setError(""); }}>Use another email</button>
          </form>
        )}
        {error && <p role="alert" className="error">{error}</p>}
      </div>
    </main>
  );
}
