// The render page reports readiness here (see apps/web/src/components/RenderSheet.tsx).
declare global {
  interface Window { __chitrapxReady?: { ok: boolean; errors: string[] } }
}
export {};
