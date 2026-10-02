// Ported from open-screenshot-generator (MIT), src/components/open-screenshot-generator/elements/DeviceFrameElement.tsx
"use client";
import type React from 'react';
import { useState, useRef } from 'react';
import { Button } from '../shims/ui';
import { Input } from '../shims/ui';
import { UploadCloudIcon, ImagePlusIcon } from '../shims/icons';
import type { DeviceFrameElementProps as DeviceFrameElementType, DeviceType, DeviceStyleType } from '@chitrapx/document';
import { getDeviceDescriptor } from '../lib/deviceRegistry';
import { cn } from '../shims/utils';
import { withBasePath } from '../shims/basePath';
import { useImageSrc } from '../shims/mediaStore';
import { saveImageBlobAsset } from '../shims/assetStore';
import { trackScreenshotUploaded } from '../shims/analytics';
import { getFlatDeviceChrome, getFlatFrameStyles, renderChassis } from './deviceChrome';

// Chitrapx: imported directly; the app code-splits renderer routes instead of next/dynamic.
import { Device3DRenderer } from './Device3DRenderer';

interface DeviceFrameElementProps {
  element: DeviceFrameElementType;
  onUpdate: (updatedElement: Partial<DeviceFrameElementType>) => void;
  isSelected: boolean;
}

export function DeviceFrameElement({ element, onUpdate, isSelected }: DeviceFrameElementProps) {
  // asset:<id> references resolve to a cached object URL over the Dexie blob;
  // template/public paths pass through untouched. undefined while resolving.
  const screenshot = useImageSrc(element.screenshotSrc);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<'customFrame' | 'screenshot' | null>(null);
  // Add a state to track if high-quality rendering should be used
  const [useHighQualityRendering, setUseHighQualityRendering] = useState(true);

  // Uploads land in the Dexie media table and the element keeps only an
  // asset:<id> reference — inlining the file as a data URL made every undo
  // snapshot and autosave duplicate it (issue #19).
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const target = uploadTarget;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setUploadTarget(null);
    if (!file || !target) return;
    try {
      const asset = await saveImageBlobAsset(file, { name: file.name });
      if (target === 'customFrame' && element.deviceType === 'custom') {
        onUpdate({
          customFrameSrc: asset.ref,
          screenshotSrc: undefined, // Reset screenshot if custom frame changes
          screenshotRect: undefined,
          naturalScreenshotWidth: undefined,
          naturalScreenshotHeight: undefined,
        });
      } else if (target === 'screenshot') {
        // For predefined devices the screenshot fills the already padded screen
        // area; only the 'custom' frame gets the 5% inset.
        const initialRect =
          element.deviceType === 'custom'
            ? { left: 5, top: 5, width: 90, height: 90 }
            : { left: 0, top: 0, width: 100, height: 100 };
        onUpdate({
          screenshotSrc: asset.ref,
          naturalScreenshotWidth: asset.width,
          naturalScreenshotHeight: asset.height,
          screenshotRect: initialRect,
        });
        trackScreenshotUploaded({ source: 'canvas', deviceType: element.deviceType });
      }
    } catch (error) {
      console.error('Could not store the uploaded image.', error);
    }
  };

  const triggerFileUpload = (target: 'customFrame' | 'screenshot') => {
    setUploadTarget(target);
    fileInputRef.current?.click();
  };

  // Corner-handle resizing changes element.scale (not element.size), and the wrapper
  // renders at size * scale — so any px value must be derived from the effective width.
  const effectiveWidth = element.size.width * (element.scale || 1);

  // Per-device chrome (outer radius, body colour, notch/island/punch-hole) is
  // shared with VideoDeviceElement — see elements/deviceChrome.tsx. Screen
  // geometry itself still comes from the device registry via that module.
  const chrome = getFlatDeviceChrome(element.deviceType, effectiveWidth);
  const deviceLabel = chrome.label;
  const framePaddingPercent = chrome.paddingPercent;
  const screenBorderRadius = chrome.screenBorderRadius;
  const deviceFrameOuterBorderRadius = chrome.outerBorderRadius;
  const deviceFrameBgColor = chrome.bodyColor;
  const notchElement = element.deviceType === 'custom' ? null : chrome.notch;

  // SVG-based rendering for device frames with perspective transforms
  const renderDeviceSVG = (
    borderRadius: string,
    screenRadius: string,
    paddingPercent: { top: number; right: number; bottom: number; left: number },
    screenBackgroundColor = '#000',
    frameBackgroundColor = '#111'
  ) => {
    // Convert borderRadius from CSS format (like '16px' or '1rem') to a number
    const extractRadiusNumber = (radius: string): number => {
      const num = parseFloat(radius.replace(/[^\d.]/g, ''));
      return isNaN(num) ? 16 : num;
    };
    
    const frameRadiusValue = extractRadiusNumber(borderRadius);
    const screenRadiusValue = extractRadiusNumber(screenRadius);
    
    // Calculate screen position and size based on padding percentages
    const screenLeft = paddingPercent.left;
    const screenTop = paddingPercent.top;
    const screenWidth = 100 - paddingPercent.left - paddingPercent.right;
    const screenHeight = 100 - paddingPercent.top - paddingPercent.bottom;
    
    // Notch rendering (simplified). Only iOS *phones* get the notch pill —
    // iPads are all-screen slabs with no cutout.
    let notchElement = null;
    const svgDescriptor = getDeviceDescriptor(element.deviceType);
    if (svgDescriptor.platform === 'ios' && svgDescriptor.category === 'phone') {
      const notchWidth = 28;
      const notchHeight = 4;
      notchElement = (
        <rect
          x={`${(100 - notchWidth) / 2}%`}
          y={`${screenTop * 0.4}%`}
          width={`${notchWidth}%`}
          height={`${notchHeight}%`}
          rx={notchHeight / 2}
          ry={notchHeight / 2}
          fill={frameBackgroundColor}
        />
      );
    } else if (element.deviceType === 'android-punch-hole') {
      // Punch hole
      const punchSize = 4;
      notchElement = (
        <circle
          cx={`${50}%`}
          cy={`${screenTop * 0.8}%`}
          r={`${punchSize / 2}%`}
          fill={frameBackgroundColor}
        />
      );
    } else if (element.deviceType === 'android-notch') {
      // Android notch
      const notchWidth = 25;
      const notchHeight = 3;
      notchElement = (
        <rect
          x={`${(100 - notchWidth) / 2}%`}
          y={`${screenTop * 0.4}%`}
          width={`${notchWidth}%`}
          height={`${notchHeight}%`}
          rx={notchHeight / 2}
          ry={notchHeight / 2}
          fill={frameBackgroundColor}
        />
      );
    }
    
    return (
      <svg 
        width="100%" 
        height="100%" 
        viewBox="0 0 100 100" 
        preserveAspectRatio="none"
        style={{
          overflow: 'visible',
          position: 'absolute',
          inset: 0,
        }}
      >
        {/* Device frame outer shape with shadow */}
        <defs>
          <filter id={`shadow-${element.id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.3" />
          </filter>
        </defs>
        
        {/* Main device frame shape */}
        <rect 
          x="0" 
          y="0" 
          width="100" 
          height="100" 
          rx={frameRadiusValue} 
          ry={frameRadiusValue} 
          fill={frameBackgroundColor}
          filter={`url(#shadow-${element.id})`}
          vectorEffect="non-scaling-stroke"
          shapeRendering="geometricPrecision"
        />
        
        {/* Screen area */}
        <rect
          x={screenLeft}
          y={screenTop}
          width={screenWidth}
          height={screenHeight}
          rx={screenRadiusValue}
          ry={screenRadiusValue}
          fill={screenBackgroundColor}
          vectorEffect="non-scaling-stroke"
          shapeRendering="geometricPrecision"
        />
        
        {/* Notch or punch hole if applicable */}
        {notchElement}
      </svg>
    );
  };
  
  // Define device perspective transforms with mirror-matching values for left and right
  const getDevicePerspectiveTransform = (styleType: DeviceStyleType = 'normal'): string => {
    switch (styleType) {
      case 'perspective-left':
        // Mirror the right perspective for consistency
        return 'matrix3d(1.04397, 0.095046, 0, -3.13e-05, -0.236454, 0.928959, 0, -3.99e-05, 0, 0, 1, 0, 26.0176, 24.4342, 0, 1)';
      case 'perspective-right':
        return 'matrix3d(1.04397, -0.095046, 0, 3.13e-05, 0.236454, 0.928959, 0, -3.99e-05, 0, 0, 1, 0, -26.0176, 24.4342, 0, 1)';
      case 'perspective-slight-right':
        return 'matrix3d(1.02397, -0.065046, 0, 2.13e-05, 0.136454, 0.968959, 0, -1.99e-05, 0, 0, 1, 0, -16.0176, 14.4342, 0, 1)';
      case 'perspective-slight-left':
        // Mirror the slight-right perspective for consistency
        return 'matrix3d(1.02397, 0.065046, 0, -2.13e-05, -0.136454, 0.968959, 0, -1.99e-05, 0, 0, 1, 0, 16.0176, 14.4342, 0, 1)';
      case 'perspective-front':
        return 'matrix3d(1, 0, 0, 0, 0, 0.98, 0, 0.0001, 0, 0, 1, 0, 0, 8, 0, 1)';
      case 'custom':
        return element.matrix3d || 'none';
      default:
        return 'none';
    }
  };
  
  // For SVG-based rendering
  const createSVGDeviceFrame = (color: string = '#000', opacity: number = 0.2) => {
    const frameRadius = parseFloat(String(deviceFrameOuterBorderRadius).replace(/[^\d.]/g, ''));
    const screenRadius = parseFloat(String(screenBorderRadius).replace(/[^\d.]/g, ''));
    
    return `
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="100" height="100" 
          rx="${frameRadius}" ry="${frameRadius}" 
          fill="none" 
          stroke="${color}" 
          stroke-opacity="${opacity}" 
          stroke-width="0.5" 
          vector-effect="non-scaling-stroke" />
      </svg>
    `;
  };
  
  // True-3D mode: rendered with three.js (real geometry, lighting and a camera
  // whose distance is proportional to the device) so the depth reads identically
  // at any element size and the screenshot wraps the screen face exactly.
  const is3DMode = element.styleType === '3d-left' || element.styleType === '3d-right';

  // Check if we're using the SVG perspective mode
  const usingSvgPerspectiveMode = element.styleType && element.styleType !== 'normal' && !is3DMode;

  // Colored-device presets: recolor / fade / hollow out the flat frame.
  // MacBook/iMac bodies are drawn by chrome.chassis nodes; the frame div stays
  // invisible so it doesn't paint a slab behind the lid/base silhouette, and
  // the outline preset is ignored there (no chassis equivalent — see
  // deviceChrome.getFlatFrameStyles for the rationale).
  const hasChassis = !!chrome.chassis;
  const frameFill = element.frameColor ?? deviceFrameBgColor;
  const frameAlpha = element.frameOpacity ?? 1;
  const isOutlineFrame = !hasChassis && element.frameStyle === 'outline';
  const frameFillCss = frameAlpha >= 1
    ? frameFill
    : `color-mix(in srgb, ${frameFill} ${Math.round(frameAlpha * 100)}%, transparent)`;

  // Container style with hardware acceleration
  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    perspective: '1200px',
    // Only apply transform at the container level when in perspective mode
    transform: usingSvgPerspectiveMode ? getDevicePerspectiveTransform(element.styleType) : 'none',
    transformStyle: 'preserve-3d',
    backfaceVisibility: 'hidden',
    // The global .device-container drop-shadow reads as a dirty halo behind
    // see-through or hollow frames — suppress it there (inline beats the class)
    filter: isOutlineFrame || frameAlpha < 1 ? 'none' : undefined,
  };

  // Frame style used for both normal and perspective modes
  const frameStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    // A drop shadow behind a see-through or hollow frame reads as a dark slab
    boxShadow: hasChassis || isOutlineFrame || frameAlpha < 1 ? 'none' : '0 4px 12px rgba(0,0,0,0.3)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    borderRadius: hasChassis ? 0 : deviceFrameOuterBorderRadius,
    backgroundColor: hasChassis || isOutlineFrame ? 'transparent' : frameFillCss,
    border: !hasChassis && isOutlineFrame ? `${Math.max(2, effectiveWidth * 0.014)}px solid ${frameFillCss}` : undefined,
    boxSizing: 'border-box',
    ['--frame-bg' as any]: frameFill,
    ...(element.notchColor ? { ['--notch-bg' as any]: element.notchColor } : {}),
    ['--scale-factor' as any]: element.scale || 1,
    overflow: 'visible',
  };

  if (is3DMode) {
    return (
      <div
        className="w-full h-full flex items-center justify-center bg-transparent group"
        // Inherit DraggableElement's cursor so a selected device shows the grab
        // hand it is actually offering, instead of a plain arrow.
        style={{ cursor: 'inherit', position: 'relative' }}
      >
        <Device3DRenderer
          deviceType={element.deviceType}
          side={element.styleType === '3d-left' ? 'left' : 'right'}
          screenshotSrc={screenshot}
          objectFit={element.screenshotObjectFit || 'cover'}
          pose={element.pose3d}
          frameColor={element.frameColor3d}
        />
        {/* Chitrapx: no 'Mockup' label or upload button; an empty 3D screen stays blank. */}
        <Input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="image/*"
          onChange={handleImageUpload}
        />
      </div>
    );
  }
  
  // Screen style used for both normal and perspective modes.
  // Absolutely positioned with px insets derived from the effective width so the
  // bezel is uniform on all sides and scales with both size and scale. (The old
  // margin-based layout was broken: CSS % margins resolve against the WIDTH even
  // for top/bottom, while the height calc used the height — so the bottom bezel
  // grew as the element got taller, e.g. the Android bar issue.)
  const bezelPx = (percent: number) => (effectiveWidth * percent) / 100;
  const screenStyle: React.CSSProperties = {
    position: 'absolute',
    top: `${bezelPx(framePaddingPercent.top)}px`,
    right: `${bezelPx(framePaddingPercent.right)}px`,
    bottom: `${bezelPx(framePaddingPercent.bottom)}px`,
    left: `${bezelPx(framePaddingPercent.left)}px`,
    backgroundColor: '#000',
    overflow: 'hidden',
    borderRadius: screenBorderRadius,
    zIndex: 1,
  };
  
  return (
    <div
      className="w-full h-full flex items-center justify-center bg-transparent group"
      // See the 3D branch above: inherit the draggable's cursor.
      style={{ cursor: 'inherit', position: 'relative' }}
    >
      {/* Apply transform to the outer container */}
      <div
        className={usingSvgPerspectiveMode ? "device-container-perspective" : "device-container"}
        style={containerStyle}
      >
        {/* Use the same DOM structure for both modes */}
        <div style={frameStyle} data-device-frame={element.id}>
          {/* MacBook/iMac body shells sit behind the screen area */}
          {renderChassis(chrome, element.frameOpacity)}
          <div style={screenStyle} data-device-screen={element.id}> {/* Using the unified screen style */}
            {/* All notches/islands/cutouts are anchored inside the screen so they
                stay glued to its top edge at any size or aspect ratio */}
            {notchElement}
            {screenshot && element.screenshotRect ? (
              <div
                style={{
                  position: 'absolute',
                  top: `${element.screenshotRect.top}%`,
                  left: `${element.screenshotRect.left}%`,
                  width: `${element.screenshotRect.width}%`,
                  height: `${element.screenshotRect.height}%`,
                  overflow: 'hidden',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <img
                  src={withBasePath(screenshot)}
                  alt={`${element.deviceType} screenshot`}
                  style={{
                    cursor: 'inherit',
                    opacity: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: element.screenshotObjectFit || "cover",
                    position: 'absolute',
                    top: 0,
                    left: 0,
                  }}
                  onLoad={e => { (e.currentTarget as HTMLImageElement).style.opacity = '1'; }}
                  data-ai-hint="app interface mobile"
                  draggable={false}
                />
              </div>
            ) : (
              // Chitrapx: neutral placeholder until a screenshot is placed; never editor UI in a render.
              <div data-empty-screen="" style={{ width: '100%', height: '100%', background: 'linear-gradient(160deg, #e7e9ee 0%, #f5f6f8 55%, #e9ebf0 100%)' }} />
            )}
          </div>
        </div>
      </div>

      <Input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        onChange={handleImageUpload}
      />
    </div>
  );
}

