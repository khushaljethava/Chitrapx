"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChitrapxDoc } from "@chitrapx/document";
import type { RenderExtras } from "@chitrapx/renderer";
import { setRefreshGuard } from "@/lib/refreshGuard.ts";
import type { FontFamilyRow } from "@/server/fonts.ts";
import { EditorAssetsProvider } from "./assets.tsx";
import { EditorContext } from "./context.tsx";
import { LiveAssetWatcher, LiveContext } from "./live/context.tsx";
import { useLiveSync, type Me } from "./live/useLiveSync.ts";
import { useAutosave } from "./save.ts";
import { useShortcuts } from "./shortcuts.ts";
import { createEditorStore } from "./store.ts";
import { Canvas } from "./ui/Canvas.tsx";
import { ConflictDialog } from "./ui/ConflictDialog.tsx";
import { Inspector } from "./ui/Inspector.tsx";
import { LeftPanel } from "./ui/LeftPanel.tsx";
import { DocJobProvider } from "./docJobs.tsx";
import { PresenceBar } from "./ui/PresenceBar.tsx";
import { Toolbar } from "./ui/Toolbar.tsx";
import type { PickerAsset } from "./ui/fields.tsx";

export function Editor({ appId, project, assets, assetUrls, fonts, extras, openTranslations, glossary, me = null, canEdit = true }: {
  appId: string;
  project: { id: string; name: string; doc: ChitrapxDoc; revision: number };
  assets: PickerAsset[];
  assetUrls: Record<string, string>;
  fonts: FontFamilyRow[];
  extras: RenderExtras;
  openTranslations?: boolean;
  glossary: string[];
  /** SP15: shown to others in the project (presence). */
  me?: Me | null;
  /** SP15: from `canSendCommands`; viewers get presence only. */
  canEdit?: boolean;
}) {
  const [store] = useState(() => createEditorStore({ projectId: project.id, doc: project.doc, revision: project.revision }));
  // A solo save that meets someone else's edit hands its changes to live co-editing instead of the conflict dialog.
  const onConflict = useRef<(revision: number) => boolean>(() => false);
  const autosave = useAutosave(store, { onConflict: (revision) => onConflict.current(revision) });
  const live = useLiveSync(store, autosave, me, canEdit);
  useEffect(() => { onConflict.current = live.onConflict; });
  const { conflict, loadTheirs, keepMine, reportConflict } = autosave;
  const { flush, adoptServerDoc } = live;
  const status = live.status ?? autosave.status;
  const error = live.status ? live.error : autosave.error;
  useShortcuts(store);
  // "Refresh" on the new-version banner saves first, so a reload never drops edits it could still send.
  useEffect(() => setRefreshGuard(flush), [flush]);
  const liveValue = useMemo(() => ({ peers: live.peers, cursors: live.cursors, previews: live.previews, sendCursor: live.sendCursor }),
    [live.peers, live.cursors, live.previews, live.sendCursor]);

  return (
    <EditorContext.Provider value={store}>
      <LiveContext.Provider value={liveValue}>
      <EditorAssetsProvider appId={appId} assets={assets} urls={assetUrls} fonts={fonts} extras={extras}>
      {live.mode === "live" && <LiveAssetWatcher />}
      <DocJobProvider flush={flush} adoptServerDoc={adoptServerDoc}>
      <div className="flex h-screen flex-col">
        <Toolbar name={project.name} projectId={project.id} status={status} error={error} flush={flush} adoptServerDoc={adoptServerDoc} reportConflict={reportConflict} openTranslations={openTranslations} glossary={glossary}
          presence={<PresenceBar peers={live.peers} live={live.mode === "live"} notice={live.notice} onDismiss={live.dismissNotice} selfId={me?.userId} />} />
        <div className="flex min-h-0 flex-1">
          <LeftPanel flush={flush} />
          <Canvas />
          <Inspector />
        </div>
      </div>
      </DocJobProvider>
      </EditorAssetsProvider>
      </LiveContext.Provider>
      {conflict && <ConflictDialog source={conflict.source} onTheirs={loadTheirs} onMine={keepMine} />}
    </EditorContext.Provider>
  );
}
