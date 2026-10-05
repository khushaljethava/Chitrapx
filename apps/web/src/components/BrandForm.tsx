"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Brand } from "@chitrapx/db/schema";
import { api } from "@/server/api.ts";
import { FontPicker } from "@/editor/ui/FontPicker.tsx";

type AppData = { id: string; name: string; description: string; platformHint: string; brand: Brand };

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex gap-2">
        <input type="color" aria-label={`${label} picker`} className="h-9 w-12 rounded border border-neutral-300 dark:border-neutral-700" value={value || "#000000"} onChange={(e) => onChange(e.target.value)} />
        <input id={id} className="input" placeholder="#4F46E5" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

export function BrandForm({ app }: { app: AppData }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: app.name, description: app.description, platformHint: app.platformHint,
    primaryColor: app.brand.primaryColor ?? "", secondaryColor: app.brand.secondaryColor ?? "",
    headingFont: app.brand.headingFont ?? "", bodyFont: app.brand.bodyFont ?? "",
  });
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const opt = (v: string) => (v.trim() ? v.trim() : undefined);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus({});
    try {
      await api(`/api/apps/${app.id}`, "PATCH", {
        name: form.name, description: form.description, platformHint: form.platformHint,
        brand: { primaryColor: opt(form.primaryColor), secondaryColor: opt(form.secondaryColor), headingFont: opt(form.headingFont), bodyFont: opt(form.bodyFont) },
      });
      setStatus({ ok: "Saved" });
      router.refresh();
    } catch (err) { setStatus({ error: (err as Error).message }); }
  }

  return (
    <form onSubmit={save} className="card space-y-4">
      <h2 className="font-semibold">App and brand kit</h2>
      <p className="text-sm text-neutral-500">The AI uses these to write copy and style your screenshots.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="b-name">App name</label>
          <input id="b-name" className="input" required maxLength={80} value={form.name} onChange={(e) => set("name")(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="b-platform">Platform</label>
          <select id="b-platform" className="input" value={form.platformHint} onChange={(e) => set("platformHint")(e.target.value)}>
            <option value="both">iOS and Android</option><option value="ios">iOS</option><option value="android">Android</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="b-desc">What does the app do?</label>
          <textarea id="b-desc" className="input min-h-24" maxLength={2000} value={form.description} onChange={(e) => set("description")(e.target.value)} />
        </div>
        <ColorField id="b-primary" label="Primary colour" value={form.primaryColor} onChange={set("primaryColor")} />
        <ColorField id="b-secondary" label="Secondary colour" value={form.secondaryColor} onChange={set("secondaryColor")} />
        <FontPicker id="b-hfont" label="Heading font" value={form.headingFont} onChange={set("headingFont")} />
        <FontPicker id="b-bfont" label="Body font" value={form.bodyFont} onChange={set("bodyFont")} />
      </div>
      <div className="flex items-center gap-3">
        <button className="btn">Save</button>
        {status.ok && <span className="text-sm text-green-600">{status.ok}</span>}
        {status.error && <span role="alert" className="error">{status.error}</span>}
      </div>
    </form>
  );
}
