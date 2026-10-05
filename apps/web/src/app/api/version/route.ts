export const dynamic = "force-dynamic";

/** The build this server runs (baked in at build time by next.config.ts). Public; reveals nothing else. */
export async function GET() {
  return Response.json({ buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "" }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
