import Link from "next/link";
import { redirect } from "next/navigation";
import { AcceptInvite } from "@/components/Workspaces.tsx";
import { ROLE_HINT, ROLE_LABEL } from "@/components/teamModel.ts";
import { currentUser } from "@/server/context.ts";
import { HttpError } from "@/server/http.ts";
import { inviteInfo } from "@/server/members.ts";

export const metadata = { title: "Join a workspace · Chitrapx", robots: { index: false, follow: false } };

const MESSAGE = {
  used: "This invite has already been used.",
  revoked: "This invite was cancelled. Ask for a new one.",
  expired: "This invite has expired. Ask for a new one.",
} as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  const info = await inviteInfo(token, user).catch((e) => { if (e instanceof HttpError && e.status === 404) return null; throw e; });
  return (
    <main className="flex min-h-screen flex-col">
      <header className="mx-auto w-full max-w-6xl px-4 py-4">
        <Link href="/" className="font-display text-lg font-bold tracking-tight">Chitrapx</Link>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold">Join a workspace</h1>
          </div>
          {!info ? <p className="card text-sm text-neutral-600 dark:text-neutral-400">This invite link is not valid. Check that you copied all of it.</p>
            : info.status === "ok" ? (
              <div className="card space-y-4">
                <p className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">You are invited to <strong className="text-neutral-900 dark:text-neutral-100">{info.workspaceName}</strong> as <strong className="text-neutral-900 dark:text-neutral-100">{ROLE_LABEL[info.role]}</strong> ({ROLE_HINT[info.role].toLowerCase()}).</p>
                <AcceptInvite token={token} workspaceName={info.workspaceName} />
              </div>
            ) : info.status === "wrong_email" ? (
              <p className="card text-sm text-neutral-600 dark:text-neutral-400">This invite is for <strong className="text-neutral-900 dark:text-neutral-100">{info.email}</strong>, but you are signed in as {user.email}. Sign out and sign in with that email.</p>
            ) : <p className="card text-sm text-neutral-600 dark:text-neutral-400">{MESSAGE[info.status]}</p>}
          <div className="flex items-center justify-between gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
            <Link href="/dashboard" className="text-sm text-neutral-500 hover:text-neutral-900 hover:underline dark:hover:text-neutral-100">Go to my dashboard</Link>
            <form action="/auth/signout" method="post"><button className="btn-ghost">Sign out</button></form>
          </div>
        </div>
      </div>
    </main>
  );
}
