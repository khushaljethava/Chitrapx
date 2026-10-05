"use client";

import type { LaunchImage } from "./launchModel.ts";

/** The app's image uploads as a pickable grid; picked ones are ringed and numbered in pick order. */
export function ImagePicker({ images, selected, onPick }: { images: LaunchImage[]; selected: string[]; onPick: (id: string) => void }) {
  if (!images.length) return <p className="text-sm text-neutral-500">Upload screenshots or images on the app page first.</p>;
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
      {images.map((img) => {
        const n = selected.indexOf(img.id);
        return (
          <button key={img.id} type="button" onClick={() => onPick(img.id)} aria-pressed={n >= 0}
            className={`relative overflow-hidden rounded-lg border-2 ${n >= 0 ? "border-indigo-600" : "border-transparent"}`}>
            <img src={img.url} alt={`Upload ${img.width}×${img.height}`} className="aspect-square w-full bg-neutral-100 object-contain dark:bg-neutral-800" loading="lazy" />
            {n >= 0 && selected.length > 1 && <span className="absolute left-1 top-1 rounded bg-indigo-600 px-1.5 text-xs text-white">{n + 1}</span>}
          </button>
        );
      })}
    </div>
  );
}
