/**
 * Resolves once everything inside `root` has painted: web fonts, every image decoded, every
 * 3D device drawn. Errors are collected by name so an export can fail loudly instead of
 * shipping a PNG with holes (OSG's exportRaster.ts documents that failure mode).
 */
export async function waitForRender(root: ParentNode, timeoutMs = 45_000): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];
  const deadline = Date.now() + timeoutMs;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  await document.fonts.ready;
  await Promise.all([...root.querySelectorAll("img")].map(async (img) => {
    if (!img.getAttribute("src")) return;
    try { await img.decode(); } catch { errors.push(`image_failed:${img.getAttribute("src")}`); }
  }));
  while (root.querySelector('[data-device3d="pending"]')) {
    if (Date.now() > deadline) { errors.push("timeout:3d_device"); break; }
    await sleep(50);
  }
  if (root.querySelector('[data-device3d="error"]')) errors.push("device3d_failed");
  // Screen recordings: the frame for the current time must be decoded.
  while ([...root.querySelectorAll<HTMLVideoElement>("video[data-video-ready]")].some((v) => v.dataset.videoReady === "0")) {
    if (Date.now() > deadline) { errors.push("timeout:video"); break; }
    await sleep(30);
  }
  if (root.querySelector('video[data-video-ready="error"]')) errors.push("video_failed");
  await frame();
  await frame();
  return { ok: errors.length === 0, errors };
}
