"use client";

export function ConflictDialog({ source, onTheirs, onMine }: { source: "save" | "draft"; onTheirs: () => void; onMine: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="conflict-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card max-w-md space-y-4">
        <h2 id="conflict-title" className="text-lg font-semibold">This project changed somewhere else</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {source === "draft"
            ? "You have unsaved changes on this device from an earlier visit, but the project has been saved since then."
            : "Someone saved this project in another tab or on another device while you were editing."}
          {" "}Choose which version to keep. The other one is replaced.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onTheirs}>Load the saved version</button>
          <button type="button" className="btn" onClick={onMine}>Keep my changes</button>
        </div>
      </div>
    </div>
  );
}
