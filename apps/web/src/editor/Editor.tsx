"use client";

import { useState } from "react";
import type { ChitrapxDoc } from "@chitrapx/document";
import { EditorAssetsProvider } from "./assets.tsx";
import { EditorContext } from "./context.tsx";
import { useAutosave } from "./save.ts";
import { useShortcuts } from "./shortcuts.ts";
import { createEditorStore } from "./store.ts";
import { Canvas } from "./ui/Canvas.tsx";
import { ConflictDialog } from "./ui/ConflictDialog.tsx";
import { Inspector } from "./ui/Inspector.tsx";
import { LeftPanel } from "./ui/LeftPanel.tsx";
import { Toolbar } from "./ui/Toolbar.tsx";
import type { PickerAsset } from "./ui/fields.tsx";

export function Editor({ appId, project, assets, assetUrls }: {
  appId: string;
  project: { id: string; name: string; doc: ChitrapxDoc; revision: number };
  assets: PickerAsset[];
  assetUrls: Record<string, string>;
}) {
  const [store] = useState(() => createEditorStore({ projectId: project.id, doc: project.doc, revision: project.revision }));
  const { status, error, conflict, loadTheirs, keepMine, flush, adoptServerDoc, reportConflict } = useAutosave(store);
  useShortcuts(store);

  return (
    <EditorContext.Provider value={store}>
      <EditorAssetsProvider appId={appId} assets={assets} urls={assetUrls}>
      <div className="flex h-screen flex-col">
        <Toolbar name={project.name} projectId={project.id} status={status} error={error} flush={flush} adoptServerDoc={adoptServerDoc} reportConflict={reportConflict} />
        <div className="flex min-h-0 flex-1">
          <LeftPanel flush={flush} />
          <Canvas />
          <Inspector />
        </div>
      </div>
      </EditorAssetsProvider>
      {conflict && <ConflictDialog source={conflict.source} onTheirs={loadTheirs} onMine={keepMine} />}
    </EditorContext.Provider>
  );
}
