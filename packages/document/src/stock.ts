/**
 * Stock photos shipped with the app for templates (`stock:<file>`), served from the web app at
 * /stock/<file>. Each file has a provenance record in packages/assets/stock.json; the bytes live in
 * apps/web/public/stock. They are fixed, public and shared, so unlike `asset:` sources they belong
 * to no workspace and need no signed URL.
 */
export const STOCK_PREFIX = "stock:";
const STOCK_FILE = /^[a-z0-9][a-z0-9-]{0,80}\.(png|webp|jpg)$/;

export const stockSrc = (file: string) => {
  if (!STOCK_FILE.test(file)) throw new Error(`bad stock file name: ${file}`);
  return `${STOCK_PREFIX}${file}`;
};

/** The web path for a `stock:` source, or null if it is not one (or names anything but a plain file). */
export function stockUrl(src: string): string | null {
  if (!src.startsWith(STOCK_PREFIX)) return null;
  const file = src.slice(STOCK_PREFIX.length);
  return STOCK_FILE.test(file) ? `/stock/${file}` : null;
}

/** One provenance row in packages/assets/stock.json. */
export type StockPhoto = {
  /** File name in apps/web/public/stock. */
  file: string;
  /** Pixel size of the shipped file; restored elements take its proportions. */
  width: number;
  height: number;
  source: "pexels" | "unsplash" | "pixabay" | "original";
  sourceId: string;
  sourceUrl: string;
  photographer: string;
  photographerUrl?: string;
  license: string;
  licenseUrl: string;
  /** Date the photo was downloaded, YYYY-MM-DD. */
  retrieved: string;
  /** What was done to it (crop, background removal), so the edit counts as "modified". */
  processing: string;
  /** OSG artwork file names this photo stands in for in imported templates. */
  replaces: string[];
};
