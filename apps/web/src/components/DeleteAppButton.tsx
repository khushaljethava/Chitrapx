"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/server/api.ts";

export function DeleteAppButton({ appId }: { appId: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  async function remove() {
    if (!armed) return setArmed(true);
    await api(`/api/apps/${appId}`, "DELETE");
    router.push("/dashboard");
    router.refresh();
  }
  return (
    <button className="btn-danger" onClick={remove} onBlur={() => setArmed(false)}>
      {armed ? "Click again to delete app and its projects" : "Delete app"}
    </button>
  );
}
