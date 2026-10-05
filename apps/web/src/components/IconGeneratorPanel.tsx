"use client";

import { useState } from "react";
import { ANDROID_RESOURCE_NAME, ICON_PLATFORMS, type IconPlatform } from "@chitrapx/document";
import { iconSourceIssue, type LaunchImage } from "./launchModel.ts";
import { ImagePicker } from "./LaunchImagePicker.tsx";
import { useJobDownload } from "./useJobDownload.ts";

const PLATFORM_LABEL: Record<IconPlatform, string> = { iphone: "iPhone", ipad: "iPad", watch: "Apple Watch", mac: "Mac", android: "Android" };

/** 12.1: one square image into every store icon file, as one ZIP (1 credit). */
export function IconGeneratorPanel({ images }: { images: LaunchImage[] }) {
  const job = useJobDownload();
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [platforms, setPlatforms] = useState<IconPlatform[]>([...ICON_PLATFORMS]);
  const [includeStores, setIncludeStores] = useState(true);
  const [androidName, setAndroidName] = useState("ic_launcher");
  const [pickBackground, setPickBackground] = useState(false);
  const [background, setBackground] = useState("#ffffff");
  const source = images.find((i) => i.id === sourceId);
  const issue = source ? iconSourceIssue(source.width, source.height) : null;
  const nameOk = ANDROID_RESOURCE_NAME.test(androidName);
  const canGo = !!source && !issue?.blocking && platforms.length > 0 && (!platforms.includes("android") || nameOk) && !job.busy;

  const toggle = (p: IconPlatform) => setPlatforms((list) => (list.includes(p) ? list.filter((x) => x !== p) : ICON_PLATFORMS.filter((x) => x === p || list.includes(x))));
  const generate = () => job.start("/api/launch-assets/icons", {
    assetId: sourceId, platforms, includeStores, androidName, ...(pickBackground ? { adaptiveBackground: background } : {}),
  });

  return (
    <section className="card space-y-4" id="icons">
      <div>
        <h2 className="font-semibold">App icons</h2>
        <p className="text-sm text-neutral-500">One square image, 1024×1024 or larger, becomes every icon file Xcode, Android Studio and both stores need. 1 credit per ZIP.</p>
      </div>
      <ImagePicker images={images} selected={sourceId ? [sourceId] : []} onPick={(id) => setSourceId(id === sourceId ? null : id)} />
      {source && (
        <div className="flex flex-wrap items-center gap-6">
          <img src={source.url} alt="iOS icon preview" className="size-24 rounded-[22.37%] object-cover shadow" />
          <img src={source.url} alt="Android icon preview" className="size-24 rounded-full object-cover shadow" />
          {issue && <p className={issue.blocking ? "error" : "text-sm text-amber-600"}>{issue.message}</p>}
        </div>
      )}
      <fieldset className="flex flex-wrap gap-4 text-sm">
        {ICON_PLATFORMS.map((p) => (
          <label key={p} className="flex items-center gap-2">
            <input type="checkbox" checked={platforms.includes(p)} onChange={() => toggle(p)} /> {PLATFORM_LABEL[p]}
          </label>
        ))}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={includeStores} onChange={(e) => setIncludeStores(e.target.checked)} /> App Store and Play Store icons
        </label>
      </fieldset>
      {platforms.includes("android") && (
        <div className="flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="label">Android file name</span>
            <input className="input w-48" value={androidName} onChange={(e) => setAndroidName(e.target.value.trim())} aria-invalid={!nameOk} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pickBackground} onChange={(e) => setPickBackground(e.target.checked)} /> Adaptive icon background
          </label>
          {pickBackground
            ? <input type="color" value={background} onChange={(e) => setBackground(e.target.value)} aria-label="Adaptive icon background colour" />
            : <span className="text-xs text-neutral-500">Taken from the image&apos;s corners</span>}
          {!nameOk && <p className="error">Use lowercase letters, digits and underscores, starting with a letter.</p>}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button className="btn" disabled={!canGo} onClick={generate}>{job.busy ? "Generating…" : "Generate icons"}</button>
        {job.error && <p className="error">{job.error}</p>}
      </div>
    </section>
  );
}
