"use client";

export function ConflictDialog({ source, onTheirs, onMine }: { source: "save" | "draft"; onTheirs: () => void; onMine: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="conflict-title" className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 id="conflict-title" className="text-lg font-semibold">This project changed somewhere else</h2>
        </div>
        <p className="px-5 py-4 text-sm text-neutral-600 dark:text-neutral-400">
          {source === "draft"
            ? "You have unsaved changes on this device from an earlier visit, but the project has been saved since then."
            : "Someone saved this project in another tab or on another device while you were editing."}
          {" "}Choose which version to keep. The other one is replaced.
        </p>
        <div className="flex flex-col-reverse gap-2 border-t border-neutral-200 bg-neutral-50 px-5 py-3 sm:flex-row sm:justify-end dark:border-neutral-800 dark:bg-neutral-950/40">
          <button type="button" className="btn-ghost" onClick={onTheirs}>Load the saved version</button>
          <button type="button" className="btn" onClick={onMine}>Keep my changes</button>
        </div>
      </div>
    </div>
  );
}
