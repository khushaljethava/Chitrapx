"use client";

import { useState } from "react";
import { MOCKUP_DEVICE_IDS, MOCKUP_DEVICES, needsFitChoice, type MockupDeviceId, type MockupFit } from "@chitrapx/document";
import type { LaunchImage } from "./launchModel.ts";
import { ImagePicker } from "./LaunchImagePicker.tsx";
import { useJobDownload } from "./useJobDownload.ts";

/** Fit or fill, asked only when the screenshot's shape differs from the device's screen. */
export function FitChoice({ value, onChange }: { value: MockupFit | null; onChange: (fit: MockupFit) => void }) {
  return (
    <div className="space-y-1 text-sm">
      <p className="text-amber-600">This screenshot&apos;s shape differs from the device&apos;s screen.</p>
      <div className="flex gap-4">
        <label className="flex items-center gap-2"><input type="radio" checked={value === "fit"} onChange={() => onChange("fit")} /> Fit (show all, bars at the edges)</label>
        <label className="flex items-center gap-2"><input type="radio" checked={value === "fill"} onChange={() => onChange("fill")} /> Fill (cover the screen, crop the edges)</label>
      </div>
    </div>
  );
}

export function DeviceSelect({ value, onChange }: { value: MockupDeviceId; onChange: (d: MockupDeviceId) => void }) {
  return (
    <label className="block">
      <span className="label">Device</span>
      <select className="input w-56" value={value} onChange={(e) => onChange(e.target.value as MockupDeviceId)}>
        {MOCKUP_DEVICE_IDS.map((id) => <option key={id} value={id}>{MOCKUP_DEVICES[id].label}</option>)}
      </select>
    </label>
  );
}

/** 12.4: one screenshot inside a device frame as a PNG, transparent around the device unless a colour is chosen. Free. */
export function QuickMockupPanel({ images }: { images: LaunchImage[] }) {
  const job = useJobDownload();
  const [shotId, setShotId] = useState<string | null>(null);
  const [device, setDevice] = useState<MockupDeviceId>("iphone-15-pro");
  const [fit, setFit] = useState<MockupFit | null>(null);
  const [useBackground, setUseBackground] = useState(false);
  const [background, setBackground] = useState("#ffffff");
  const shot = images.find((i) => i.id === shotId);
  const askFit = !!shot?.width && !!shot.height && needsFitChoice(device, shot.width, shot.height);

  return (
    <section className="card space-y-4" id="mockup">
      <div>
        <h2 className="font-semibold">Device mockup</h2>
        <p className="text-sm text-neutral-500">Drop one screenshot into a device frame and download a PNG. Free, up to 30 free jobs an hour.</p>
      </div>
      <ImagePicker images={images} selected={shotId ? [shotId] : []} onPick={(id) => { setShotId(id === shotId ? null : id); setFit(null); }} />
      <div className="flex flex-wrap items-end gap-4">
        <DeviceSelect value={device} onChange={(d) => { setDevice(d); setFit(null); }} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={useBackground} onChange={(e) => setUseBackground(e.target.checked)} /> Background colour
        </label>
        {useBackground
          ? <input type="color" value={background} onChange={(e) => setBackground(e.target.value)} aria-label="Background colour" />
          : <span className="text-xs text-neutral-500">Transparent</span>}
      </div>
      {askFit && <FitChoice value={fit} onChange={setFit} />}
      <div className="flex items-center gap-3">
        <button className="btn" disabled={!shot || (askFit && !fit) || job.busy}
          onClick={() => job.start("/api/launch-assets/mockup", { assetId: shotId, deviceType: device, ...(fit ? { fit } : {}), ...(useBackground ? { background } : {}) })}>
          {job.busy ? "Rendering…" : "Download mockup"}
        </button>
        {job.error && <p className="error">{job.error}</p>}
      </div>
    </section>
  );
}
