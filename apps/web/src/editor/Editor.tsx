"use client";

import { useCallback, useState } from "react";
import type { ChitrapxDoc } from "@chitrapx/document";
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

export function Editor({ project, assets, assetUrls }: {
  project: { id: string; name: string; doc: ChitrapxDoc; revision: number };
  assets: PickerAsset[];
  assetUrls: Record<string, string>;
}) {
  const [store] = useState(() => createEditorStore({ projectId: project.id, doc: project.doc, revision: project.revision }));
  const { status, error, conflict, loadTheirs, keepMine, flush } = useAutosave(store);
  useShortcuts(store);
  const resolveSrc = useCallback((src: string) => assetUrls[src] ?? null, [assetUrls]);

  return (
    <EditorContext.Provider value={store}>
      <div className="flex h-screen flex-col">
        <Toolbar name={project.name} projectId={project.id} status={status} error={error} flush={flush} />
        <div className="flex min-h-0 flex-1">
          <LeftPanel flush={flush} />
          <Canvas resolveSrc={resolveSrc} />
          <Inspector assets={assets} />
        </div>
      </div>
      {conflict && <ConflictDialog source={conflict.source} onTheirs={loadTheirs} onMine={keepMine} />}
    </EditorContext.Provider>
  );
}
