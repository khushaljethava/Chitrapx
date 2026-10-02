/** Sources arrive pre-resolved (see resolveSources), so this is the identity. */
export function useImageSrc(src: string | undefined): string | undefined {
  return src;
}
