"use client";

import { useEffect, useState } from "react";
import type { ChitrapxDoc } from "@chitrapx/document";
import type { RenderExtras } from "@chitrapx/renderer";
import { setRefreshGuard } from "@/lib/refreshGuard.ts";
import type { FontFamilyRow } from "@/server/fonts.ts";
import { EditorAssetsProvider } from "./assets.tsx";
import { EditorContext } from "./context.tsx";
import { useAutosave } from "./save.ts";
import { useShortcuts } from "./shortcuts.ts";
import { createEditorStore } from "./store.ts";
import { Canvas } from "./ui/Canvas.tsx";
import { ConflictDialog } from "./ui/ConflictDialog.tsx";
import { Inspector } from "./ui/Inspector.tsx";
import { LeftPanel } from "./ui/LeftPanel.tsx";
import { DocJobProvider } from "./docJobs.tsx";
import { Toolbar } from "./ui/Toolbar.tsx";
import type { PickerAsset } from "./ui/fields.tsx";

export function Editor({ appId, project, assets, assetUrls, fonts, extras, openTranslations, glossary, children }: {
  /** SP15: rendered inside the editor context (the comments panel). */
  children?: React.ReactNode;
  appId: string;
  project: { id: string; name: string; doc: ChitrapxDoc; revision: number };
  assets: PickerAsset[];
  assetUrls: Record<string, string>;
  fonts: FontFamilyRow[];
  extras: RenderExtras;
  openTranslations?: boolean;
  glossary: string[];
}) {
  const [store] = useState(() => createEditorStore({ projectId: project.id, doc: project.doc, revision: project.revision }));
  const { status, error, conflict, loadTheirs, keepMine, flush, adoptServerDoc, reportConflict } = useAutosave(store);
  useShortcuts(store);
  // "Refresh" on the new-version banner saves first, so a reload never drops edits it could still send.
  useEffect(() => setRefreshGuard(flush), [flush]);

  return (
    <EditorContext.Provider value={store}>
      <EditorAssetsProvider appId={appId} assets={assets} urls={assetUrls} fonts={fonts} extras={extras}>
      <DocJobProvider flush={flush} adoptServerDoc={adoptServerDoc}>
      <div className="flex h-screen flex-col">
        <Toolbar name={project.name} projectId={project.id} status={status} error={error} flush={flush} adoptServerDoc={adoptServerDoc} reportConflict={reportConflict} openTranslations={openTranslations} glossary={glossary} />
        <div className="flex min-h-0 flex-1">
          <LeftPanel flush={flush} />
          <Canvas />
          <Inspector />
        </div>
      </div>
      </DocJobProvider>
      </EditorAssetsProvider>
      {conflict && <ConflictDialog source={conflict.source} onTheirs={loadTheirs} onMine={keepMine} />}
      {children}
    </EditorContext.Provider>
  );
}
