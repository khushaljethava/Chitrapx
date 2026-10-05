"use client";

import { createContext, useCallback, useContext } from "react";
import { migrate, type ChitrapxDoc } from "@chitrapx/document";
import { jobError } from "@/components/jobText.ts";
import { followJob, type FollowedJob } from "@/lib/followJob.ts";
import { api } from "@/server/api.ts";
import { useEditorStore } from "./context.tsx";

type Run = (start: () => Promise<{ jobId: string }>) => Promise<FollowedJob>;
const Ctx = createContext<Run | null>(null);

/**
 * AI jobs that rewrite the saved document (translate, regenerate chips): save first, keep the editor read-only
 * while the job runs so nothing can conflict with it, then load the saved result. Loading clears undo history,
 * as a version restore does.
 */
export function DocJobProvider({ flush, adoptServerDoc, children }: {
  flush: () => Promise<boolean>; adoptServerDoc: (doc: ChitrapxDoc, revision: number) => void; children: React.ReactNode;
}) {
  const store = useEditorStore();
  const run = useCallback<Run>(async (start) => {
    if (!(await flush())) throw new Error("Your latest changes are not saved yet. Check your connection and try again.");
    store.getState().setLocked(true);
    try {
      const job = await followJob((await start()).jobId);
      if (job.status === "failed") throw new Error(jobError(job.error));
      const project = await api<{ doc: unknown; revision: number }>(`/api/projects/${store.getState().projectId}`);
      adoptServerDoc(migrate(project.doc), project.revision);
      return job;
    } finally {
      store.getState().setLocked(false);
    }
  }, [flush, adoptServerDoc, store]);
  return <Ctx.Provider value={run}>{children}</Ctx.Provider>;
}

export function useDocJob(): Run {
  const run = useContext(Ctx);
  if (!run) throw new Error("useDocJob outside DocJobProvider");
  return run;
}
