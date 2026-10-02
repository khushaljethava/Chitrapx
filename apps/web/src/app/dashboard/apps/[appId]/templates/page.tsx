import Link from "next/link";
import { notFound } from "next/navigation";
import { and, count, eq } from "drizzle-orm";
import { db, schema } from "@chitrapx/db";
import { TemplateGallery } from "@/components/TemplateGallery.tsx";
import { getApp } from "@/server/apps.ts";
import { requireContext } from "@/server/context.ts";
import { HttpError } from "@/server/http.ts";
import { listTemplates, TEMPLATE_CATEGORIES } from "@/server/templates.ts";

export default async function TemplatesPage({ params }: { params: Promise<{ appId: string }> }) {
  const ctx = await requireContext();
  const app = await getApp(ctx, (await params).appId).catch((e) => { if (e instanceof HttpError && e.status === 404) notFound(); throw e; });
  const [templates, [shots]] = await Promise.all([
    listTemplates(),
    db.select({ n: count() }).from(schema.assets).where(and(eq(schema.assets.appId, app.id), eq(schema.assets.workspaceId, ctx.workspaceId), eq(schema.assets.kind, "screenshot"))),
  ]);
  return (
    <>
      <div>
        <Link href={`/dashboard/apps/${app.id}`} className="text-sm text-neutral-500 hover:underline">{app.name}</Link>
        <h1 className="text-2xl font-semibold">Start from a template</h1>
      </div>
      <TemplateGallery appId={app.id} templates={templates} categories={TEMPLATE_CATEGORIES} screenshotCount={shots?.n ?? 0} />
    </>
  );
}
