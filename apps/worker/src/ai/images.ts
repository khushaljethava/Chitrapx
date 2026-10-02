import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

/** Long edge Claude processes without downscaling; larger only costs tokens. */
const MAX_EDGE = 1568;

/** A screenshot as an inline image block: resized to fit, JPEG, base64. */
export async function imageBlock(bytes: Buffer): Promise<Anthropic.Beta.BetaImageBlockParam> {
  const jpeg = await sharp(bytes).rotate().resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer();
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } };
}
