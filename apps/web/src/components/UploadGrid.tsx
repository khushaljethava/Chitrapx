"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser.ts";
import { api } from "@/server/api.ts";

type AssetRow = { id: string; url: string; width: number | null; height: number | null };
const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp";

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function UploadGrid({ appId, assets, logoAssetId }: { appId: string; assets: AssetRow[]; logoAssetId?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  async function uploadOne(file: File) {
    if (file.size > MAX_BYTES) throw new Error(`${file.name}: larger than 25 MB`);
    const sha256 = await sha256Hex(file);
    const signed = await api<{ existing?: unknown; path?: string; token?: string }>("/api/uploads/sign", "POST", {
      appId, kind: "screenshot", size: file.size, mime: file.type, sha256,
    });
    if (signed.existing) return;
    const { error } = await createClient().storage.from("uploads").uploadToSignedUrl(signed.path!, signed.token!, file, { contentType: file.type });
    if (error) throw new Error(`${file.name}: ${error.message}`);
    await api("/api/uploads/complete", "POST", { appId, kind: "screenshot", sha256 });
  }

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    const failed: string[] = [];
    for (const [i, file] of list.entries()) {
      setProgress(`Uploading ${i + 1} of ${list.length}`);
      try { await uploadOne(file); } catch (err) { failed.push(err instanceof Error && err.message.startsWith(file.name) ? err.message : `${file.name}: ${(err as Error).message}`); }
    }
    setProgress("");
    setErrors(failed);
    router.refresh();
  }

  async function setLogo(assetId: string) {
    await api(`/api/apps/${appId}`, "PATCH", { brand: { logoAssetId: assetId } });
    router.refresh();
  }

  return (
    <section className="card space-y-4">
      <h2 className="font-semibold">Screenshots</h2>
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files); }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-sm ${dragging ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950" : "border-neutral-300 dark:border-neutral-700"}`}
      >
        <span className="font-medium">{progress || "Drop app screenshots here, or click to choose"}</span>
        <span className="text-neutral-500">PNG, JPEG or WebP, up to 25 MB each</span>
        <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
      </div>
      {errors.length > 0 && <ul role="alert" className="error list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {assets.length > 0 && (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {assets.map((a) => (
            <li key={a.id} className="group relative overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
              <img src={a.url} alt={`Screenshot ${a.width}x${a.height}`} className="aspect-[9/19.5] w-full object-cover" loading="lazy" />
              <span className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 text-[10px] text-white">{a.width}x{a.height}</span>
              {logoAssetId === a.id ? (
                <span className="absolute right-1 top-1 rounded bg-indigo-600 px-1.5 text-[10px] text-white">Logo</span>
              ) : (
                <button onClick={() => setLogo(a.id)} data-touch-reveal className="absolute right-1 top-1 rounded bg-white/90 px-1.5 text-[10px] opacity-0 group-hover:opacity-100 focus:opacity-100 dark:bg-black/80">Use as logo</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
