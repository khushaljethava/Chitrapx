import { TeamPanel } from "@/components/TeamPanel.tsx";
import { requireContext } from "@/server/context.ts";
import { listMembers } from "@/server/members.ts";

export const metadata = { title: "Team · Chitrapx" };

export default async function TeamPage() {
  const t = await listMembers(await requireContext());
  return (
    <>
      <h1 className="text-2xl font-semibold">Team</h1>
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
