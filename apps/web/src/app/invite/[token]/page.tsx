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
    <main className="mx-auto max-w-md space-y-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">Join a workspace</h1>
      {!info ? <p className="text-neutral-500">This invite link is not valid. Check that you copied all of it.</p>
        : info.status === "ok" ? (
          <div className="card space-y-3">
            <p>You are invited to <strong>{info.workspaceName}</strong> as <strong>{ROLE_LABEL[info.role]}</strong> ({ROLE_HINT[info.role].toLowerCase()}).</p>
            <AcceptInvite token={token} workspaceName={info.workspaceName} />
          </div>
        ) : info.status === "wrong_email" ? (
          <p className="text-neutral-500">This invite is for <strong>{info.email}</strong>, but you are signed in as {user.email}. Sign out and sign in with that email.</p>
        ) : <p className="text-neutral-500">{MESSAGE[info.status]}</p>}
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="text-sm text-neutral-500 hover:underline">Go to my dashboard</Link>
        <form action="/auth/signout" method="post"><button className="btn-ghost">Sign out</button></form>
      </div>
    </main>
  );
}
