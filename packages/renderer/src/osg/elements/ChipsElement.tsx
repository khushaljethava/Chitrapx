"use client";
import type { ChipsElementProps } from '@chitrapx/document';
import { cssFontFamily } from '../lib/fontService';

/** Same display compensation TextElement uses: type is drawn at fontSize / 0.3 board px. */
const DISPLAY_SCALE = 0.3;
const LINE = 1.2;
const PAD_Y = 0.35;
const PAD_X = 0.9;

/** How many whole rows of pills fit `height`; never fewer than one. */
export function chipRows(height: number, fontPx: number, gap: number): number {
  const pill = fontPx * (LINE + 2 * PAD_Y);
  return Math.max(1, Math.floor((height + gap) / (pill + gap)));
}

/**
 * Pills that wrap like words. The box is cut to the whole rows it holds, so a chip that would wrap past the
 * bottom is dropped whole, never half drawn or laid over the next element. dir="auto" puts an Arabic list's
 * first chip on the right, and the logical alignment follows it, as text does.
 */
export function ChipsElement({ element }: { element: ChipsElementProps }) {
  const fontPx = element.fontSize / DISPLAY_SCALE;
  const gap = element.gap ?? fontPx * 0.4;
  const pill = fontPx * (LINE + 2 * PAD_Y);
  const rows = chipRows(element.size.height * (element.scale || 1), fontPx, gap);
  const justify = element.align === 'center' ? 'center' : element.align === 'right' ? 'flex-end' : 'flex-start';
  return (
    <div dir="auto" data-chips="" style={{
      width: '100%', height: rows * pill + (rows - 1) * gap, display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start',
      justifyContent: justify, gap, overflow: 'hidden',
    }}>
      {(element.chips ?? []).map((chip, i) => (
        <span key={i} style={{
          display: 'inline-block', height: pill, lineHeight: `${pill}px`, maxWidth: '100%', boxSizing: 'border-box',
          padding: `0 ${fontPx * PAD_X}px`, borderRadius: pill / 2, background: element.fillColor, color: element.color,
          fontFamily: cssFontFamily(element.fontFamily), fontSize: fontPx, fontWeight: element.fontWeight || '600',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{chip}</span>
      ))}
    </div>
  );
}
