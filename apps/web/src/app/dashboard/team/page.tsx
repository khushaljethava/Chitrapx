import { TeamPanel } from "@/components/TeamPanel.tsx";
import { requireContext } from "@/server/context.ts";
import { listMembers } from "@/server/members.ts";

export const metadata = { title: "Team · Chitrapx" };

export default async function TeamPage() {
  const t = await listMembers(await requireContext());
  return (
    <>
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">Team</h1>
        <p className="text-sm text-neutral-500">Members, roles and invite links for this workspace.</p>
      </header>
      <TeamPanel
        me={t.role}
        plan={t.plan}
        seats={t.seats}
        members={t.members.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() }))}
        invites={t.invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() }))}
      />
    </>
  );
}
