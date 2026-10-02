"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/server/api.ts";

export function SocialButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" className="btn-ghost" title="Instagram, X, LinkedIn and Product Hunt sizes from your first board"
        onClick={async () => {
          setError("");
          try { const p = await api<{ id: string }>(`/api/projects/${projectId}/social`, "POST"); router.push(`/dashboard/projects/${p.id}`); }
          catch (err) { setError((err as Error).message); }
        }}>Make social images</button>
      {error && <span role="alert" className="error text-xs">{error}</span>}
    </span>
  );
}
