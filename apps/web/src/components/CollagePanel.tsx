"use client";

import { useState } from "react";
import { COLLAGE_MAX, COLLAGE_MIN, needsFitChoice, type MockupDeviceId, type MockupFit } from "@chitrapx/document";
import { collageBody, moveItem, toggleItem, type LaunchImage } from "./launchModel.ts";
import { ImagePicker } from "./LaunchImagePicker.tsx";
import { DeviceSelect, FitChoice } from "./QuickMockupPanel.tsx";
import { useJobDownload } from "./useJobDownload.ts";

/** 12.3: 2 to 12 screenshots in one grid PNG, optionally each in a device frame (1 credit). */
export function CollagePanel({ images }: { images: LaunchImage[] }) {
  const job = useJobDownload();
  const [ids, setIds] = useState<string[]>([]);
  const [autoPadding, setAutoPadding] = useState(true);
  const [padding, setPadding] = useState(40);
  const [from, setFrom] = useState("#f4f4f5");
  const [gradient, setGradient] = useState(false);
  const [to, setTo] = useState("#c7d2fe");
  const [framed, setFramed] = useState(false);
  const [device, setDevice] = useState<MockupDeviceId>("iphone-15-pro");
  const [fit, setFit] = useState<MockupFit | null>(null);
  const picked = ids.map((id) => images.find((i) => i.id === id)).filter((i): i is LaunchImage => !!i);
  const askFit = framed && picked.some((i) => i.width && i.height && needsFitChoice(device, i.width, i.height));
  const cols = Math.ceil(Math.sqrt(Math.max(1, picked.length)));
  const body = collageBody({ ids, padding: autoPadding ? null : padding, from, to: gradient ? to : null, device: framed ? device : null, fit: askFit ? fit : null });

  return (
    <section className="card space-y-4" id="collage">
      <div>
        <h2 className="font-semibold">Collage</h2>
        <p className="text-sm text-neutral-500">Pick {COLLAGE_MIN} to {COLLAGE_MAX} screenshots in the order you want them; they are laid out in a grid without stretching. 1 credit.</p>
      </div>
      <ImagePicker images={images} selected={ids} onPick={(id) => setIds((list) => toggleItem(list, id, COLLAGE_MAX))} />
      {picked.length > 0 && (
        <ol className="flex flex-wrap gap-2 text-xs">
          {picked.map((img, i) => (
            <li key={img.id} className="flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 dark:border-neutral-700">
              {i + 1}
              <button aria-label="Move earlier" disabled={i === 0} onClick={() => setIds((l) => moveItem(l, i, -1))}>↑</button>
              <button aria-label="Move later" disabled={i === picked.length - 1} onClick={() => setIds((l) => moveItem(l, i, 1))}>↓</button>
              <button aria-label="Remove" onClick={() => setIds((l) => l.filter((x) => x !== img.id))}>×</button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={autoPadding} onChange={(e) => setAutoPadding(e.target.checked)} /> Automatic spacing</label>
        {!autoPadding && (
          <label className="flex items-center gap-2">Spacing <input type="range" min={0} max={200} value={padding} onChange={(e) => setPadding(Number(e.target.value))} /> {padding} px</label>
        )}
        <label className="flex items-center gap-2">Background <input type="color" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Background colour" /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={gradient} onChange={(e) => setGradient(e.target.checked)} /> Gradient to</label>
        {gradient && <input type="color" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Gradient end colour" />}
        <label className="flex items-center gap-2"><input type="checkbox" checked={framed} onChange={(e) => setFramed(e.target.checked)} /> In a device frame</label>
        {framed && <DeviceSelect value={device} onChange={(d) => { setDevice(d); setFit(null); }} />}
      </div>
      {askFit && <FitChoice value={fit} onChange={setFit} />}
      {picked.length > 0 && (
        <div className="grid max-w-xl rounded-lg p-3" aria-label="Collage preview"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: autoPadding ? 12 : Math.min(48, padding / 4), background: gradient ? `linear-gradient(${from}, ${to})` : from }}>
          {picked.map((img) => <img key={img.id} src={img.url} alt="" className="aspect-[9/16] w-full object-contain" />)}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button className="btn" disabled={picked.length < COLLAGE_MIN || (askFit && !fit) || job.busy} onClick={() => job.start("/api/launch-assets/collage", body)}>
          {job.busy ? "Building…" : "Download collage"}
        </button>
        {job.error && <p className="error">{job.error}</p>}
      </div>
    </section>
  );
}
