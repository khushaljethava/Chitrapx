import Link from "next/link";
import { notFound } from "next/navigation";
import { CollagePanel } from "@/components/CollagePanel.tsx";
import { IconGeneratorPanel } from "@/components/IconGeneratorPanel.tsx";
import { LogoStarterPanel } from "@/components/LogoStarterPanel.tsx";
import { QuickMockupPanel } from "@/components/QuickMockupPanel.tsx";
import { getApp } from "@/server/apps.ts";
import { requireContext } from "@/server/context.ts";
import { HttpError } from "@/server/http.ts";
import { appStorage } from "@/server/storage.ts";
import { listAssets } from "@/server/uploads.ts";

/** SP12: icons, a starter logo, device mockups and collages from the app's uploads. */
export default async function LaunchAssetsPage({ params }: { params: Promise<{ appId: string }> }) {
  const ctx = await requireContext();
  const { appId } = await params;
  const app = await getApp(ctx, appId).catch((e) => { if (e instanceof HttpError && e.status === 404) notFound(); throw e; });
  const images = (await listAssets(ctx, appStorage(), app.id))
    .filter((a) => (a.kind === "screenshot" || a.kind === "image") && a.url)
    .map(({ id, url, width, height }) => ({ id, url, width, height }));
  return (
    <>
      <div>
        <Link href={`/dashboard/apps/${app.id}`} className="text-sm text-neutral-500 hover:underline">{app.name}</Link>
        <h1 className="text-2xl font-semibold">Launch assets</h1>
      </div>
      <LogoStarterPanel appId={app.id} images={images} />
      <IconGeneratorPanel images={images} />
      <QuickMockupPanel images={images} />
      <CollagePanel images={images} />
    </>
  );
}
