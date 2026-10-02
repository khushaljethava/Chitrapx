// The render page reports readiness here (see apps/web/src/components/RenderSheet.tsx).
declare global {
  interface Window {
    __chitrapxReady?: { ok: boolean; errors: string[] };
    __chitrapxVideo?: { ok: boolean; errors: string[]; duration: number; width: number; height: number };
    __chitrapxSeek?: (t: number) => Promise<void>;
  }
}
export {};
