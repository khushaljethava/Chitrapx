"use client";

import { useEffect, useRef } from "react";
import { MAX_BOARD_EDGE } from "@chitrapx/document";
import type { ArtboardElement, DeviceFrameElementProps, ElementLocaleOverride, ImageElementProps, ShapeElementProps, TextElementProps } from "@chitrapx/document";
import { ALL_FONTS } from "@chitrapx/renderer";
import { findElement, type Ref } from "../commands.ts";
import { useEditor, useEditorStore } from "../context.tsx";
import { LayoutPresets } from "./LayoutPresets.tsx";
import { AssetPicker, ColorField, NumberField, Row, SelectField, useGesture, type PickerAsset } from "./fields.tsx";

const FONT_OPTIONS = ALL_FONTS.map((f) => [f.family, f.family] as const);
const WEIGHTS = [["300", "Light"], ["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"], ["800", "Extra bold"], ["900", "Black"]] as const;
const DEVICES = [
  ["iphone-17-pro-max", "iPhone 17 Pro Max"], ["iphone-15", "iPhone 15"], ["iphone-15-pro", "iPhone 15 Pro"], ["iphone-x", "iPhone X"],
  ["android-punch-hole", "Android"], ["ipad-pro-13", "iPad Pro 13"], ["ipad-11", "iPad 11"], ["tablet-10", "Android tablet"],
  ["macbook", "MacBook"], ["imac", "iMac"], ["apple-watch", "Apple Watch"],
] as const;
const STYLES = [["normal", "Flat"], ["3d-left", "3D, facing left"], ["3d-right", "3D, facing right"]] as const;
const POSES = (["classic", "front", "upright", "side", "tilted", "reclined", "laying", "floating", "drifting", "leaning", "soaring", "isometric"] as const).map((p) => [p, p[0]!.toUpperCase() + p.slice(1)] as const);
/** Every element type's fields, optional: the inspector shows only the ones that apply. */
type AnyFields = Partial<Omit<TextElementProps, "type"> & Omit<ShapeElementProps, "type" | "borderRadius"> & Omit<DeviceFrameElementProps, "type"> & Omit<ImageElementProps, "type" | "opacity" | "borderRadius">>
  & { borderRadius?: number | string };

/** Sizes the document accepts: at least 8 px, at most the largest board edge. */
const clampEdge = (v: number) => Math.min(MAX_BOARD_EDGE, Math.max(8, v));

/** Options plus the current value when a template uses something outside the list, so it still shows. */
const withCurrent = (options: ReadonlyArray<readonly [string, string]>, value: string): ReadonlyArray<readonly [string, string]> =>
  options.some(([v]) => v === value) ? options : [[value, value], ...options];

const ANIMATIONS = [["none", "None (automatic)"], ["fade", "Fade"], ["slide-up", "Slide up"], ["slide-down", "Slide down"],
  ["slide-left", "Slide left"], ["slide-right", "Slide right"], ["scale-up", "Scale up"], ["pop", "Pop"]] as const;

const FITS = [["cover", "Fill the screen"], ["contain", "Fit inside"], ["fill", "Stretch"]] as const;

export function Inspector({ assets }: { assets: PickerAsset[] }) {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const ref = selection.length === 1 ? selection[0]! : null;
  const el = ref ? findElement(doc, ref) : undefined;
  return (
    <aside className="w-72 shrink-0 space-y-4 overflow-y-auto border-l border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      {selection.length > 1 ? <p className="text-sm text-neutral-500">{selection.length} items selected. Drag to move them together.</p>
        : ref && el ? <ElementInspector key={`${ref.boardId}:${ref.elementId}`} refr={ref} el={el} assets={assets} />
          : <BoardInspector />}
    </aside>
  );
}

function BoardInspector() {
  const store = useEditorStore();
  const groupId = useEditor((s) => s.activeGroupId);
  const boardId = useEditor((s) => s.activeBoardId);
  const board = useEditor((s) => s.doc.groups.find((g) => g.id === groupId)?.boards.find((b) => b.id === boardId));
  const g = useGesture();
  if (!board || !boardId) return <p className="text-sm text-neutral-500">Select a board or an element.</p>;
  const set = (props: Record<string, unknown>) => store.getState().apply({ type: "updateBoard", groupId, boardId, props });
  const grad = board.backgroundGradient ?? { color1: board.backgroundColor, color2: "#ffffff", angle: 180 };
  return (
    <div className="space-y-3">
      <h2 className="font-semibold">Board</h2>
      <Row label="Name" htmlFor="b-name"><input id="b-name" className="input" value={board.name} onChange={(e) => set({ name: e.target.value })} {...g} /></Row>
      <SelectField id="b-bgtype" label="Background" value={board.backgroundType ?? "solid"} options={[["solid", "Solid colour"], ["gradient", "Gradient"]] as const}
        onChange={(v) => set(v === "gradient" ? { backgroundType: v, backgroundGradient: grad } : { backgroundType: v })} />
      {board.backgroundType === "gradient" ? (
        <>
          <ColorField id="b-g1" label="From" value={grad.color1} onChange={(v) => set({ backgroundGradient: { ...grad, color1: v } })} />
          <ColorField id="b-g2" label="To" value={grad.color2} onChange={(v) => set({ backgroundGradient: { ...grad, color2: v } })} />
          <NumberField id="b-ga" label="Angle" value={grad.angle} onChange={(v) => set({ backgroundGradient: { ...grad, angle: v } })} />
        </>
      ) : (
        <ColorField id="b-bg" label="Colour" value={board.backgroundColor} onChange={(v) => set({ backgroundColor: v })} />
      )}
      <LayoutPresets groupId={groupId} boardId={boardId} />
    </div>
  );
}

function ElementInspector({ refr, el, assets }: { refr: Ref; el: ArtboardElement; assets: PickerAsset[] }) {
  const store = useEditorStore();
  const locale = useEditor((s) => s.locale);
  const base = useEditor((s) => s.doc.localization.baseLocale);
  const override = useEditor((s): ElementLocaleOverride | undefined => refr.boardId
    ? s.doc.groups.find((g) => g.id === refr.groupId)?.boards.find((b) => b.id === refr.boardId)?.localized?.[s.locale]?.[refr.elementId] : undefined);
  const localized = locale !== base && refr.boardId !== null;
  const g = useGesture();
  const content = useRef<HTMLTextAreaElement>(null);
  const a = el as unknown as AnyFields;

  useEffect(() => {
    const focus = () => content.current?.focus();
    window.addEventListener("chitrapx:edit-text", focus);
    return () => window.removeEventListener("chitrapx:edit-text", focus);
  }, []);

  const set = (props: Record<string, unknown>) => store.getState().apply({ type: "updateElement", ref: refr, props: props as Partial<ArtboardElement> });
  /** Text and font follow the language being edited; everything else is shared by all languages. */
  const setLocalizable = (key: "content" | "fontFamily", value: string) =>
    localized ? store.getState().apply({ type: "setOverride", ref: refr, locale, props: { [key]: value } }) : set({ [key]: value });
  const reset = (key: string) => store.getState().apply({ type: "resetOverride", ref: refr, locale, keys: key === "content" ? ["content", "origin"] : [key] });
  const OverrideNote = ({ k }: { k: string }) => localized && (override as Record<string, unknown> | undefined)?.[k] !== undefined
    ? <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => reset(k)}>{locale} override. Reset to {base}</button> : null;
  const sz = { w: el.size.width * (el.scale || 1), h: el.size.height * (el.scale || 1) };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold capitalize">{el.type === "device" ? "Device" : el.type === "video-device" ? "Phone with video" : el.type}</h2>
        {localized && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200">Editing {locale}</span>}
      </div>

      {el.type === "text" && (
        <>
          <Row label="Text" htmlFor="i-content">
            <textarea id="i-content" ref={content} className="input min-h-20" value={override?.content ?? a.content ?? ""} onChange={(e) => setLocalizable("content", e.target.value)} {...g} />
            <OverrideNote k="content" />
          </Row>
          <SelectField id="i-font" label="Font" value={override?.fontFamily ?? a.fontFamily ?? ""} options={withCurrent(FONT_OPTIONS, override?.fontFamily ?? a.fontFamily ?? "")} onChange={(v) => setLocalizable("fontFamily", v)} />
          <OverrideNote k="fontFamily" />
          <div className="grid grid-cols-2 gap-2">
            <NumberField id="i-size" label="Size" value={a.fontSize ?? 40} min={1} onChange={(v) => set({ fontSize: Math.max(1, v) })} />
            <SelectField id="i-weight" label="Weight" value={String(a.fontWeight ?? "400")} options={WEIGHTS} onChange={(v) => set({ fontWeight: v })} />
            <NumberField id="i-lh" label="Line height" value={a.lineHeight ?? 1.2} step={0.05} onChange={(v) => set({ lineHeight: v })} />
            <NumberField id="i-ls" label="Letter spacing" value={a.letterSpacing ?? 0} step={0.5} onChange={(v) => set({ letterSpacing: v })} />
          </div>
          <ColorField id="i-color" label="Colour" value={a.color ?? "#000000"} onChange={(v) => set({ color: v })} />
          <div className="flex gap-1" role="group" aria-label="Alignment">
            {(["left", "center", "right"] as const).map((al) => (
              <button key={al} type="button" className={(a.textAlign ?? "left") === al ? "btn flex-1 px-2" : "btn-ghost flex-1 px-2"} onClick={() => set({ textAlign: al })}>{al[0]!.toUpperCase() + al.slice(1)}</button>
            ))}
            <button type="button" className={a.fontStyle === "italic" ? "btn px-3" : "btn-ghost px-3"} onClick={() => set({ fontStyle: a.fontStyle === "italic" ? "normal" : "italic" })}><em>I</em></button>
          </div>
        </>
      )}

      {el.type === "shape" && (
        <>
          <ColorField id="i-fill" label="Fill" value={a.fillColor ?? "#000000"} onChange={(v) => set({ fillColor: v })} />
          <ColorField id="i-stroke" label="Outline" value={a.strokeColor ?? "#000000"} onChange={(v) => set({ strokeColor: v })} />
          <div className="grid grid-cols-2 gap-2">
            <NumberField id="i-sw" label="Outline width" value={a.strokeWidth ?? 0} min={0} onChange={(v) => set({ strokeWidth: Math.max(0, v) })} />
            {a.shapeType === "rectangle" && <NumberField id="i-radius" label="Corner radius" value={Number(a.borderRadius ?? 0)} min={0} onChange={(v) => set({ borderRadius: Math.max(0, v) })} />}
          </div>
        </>
      )}

      {el.type === "device" && (
        <>
          <SelectField id="i-device" label="Model" value={a.deviceType ?? "iphone-15"} options={withCurrent(DEVICES, a.deviceType ?? "iphone-15")} onChange={(v) => set({ deviceType: v })} />
          <SelectField id="i-style" label="Style" value={(a.styleType ?? "normal") as "normal"} options={STYLES} onChange={(v) => set({ styleType: v, ...(v !== "normal" && !a.pose3d ? { pose3d: "front" } : {}) })} />
          {a.styleType?.startsWith("3d") ? (
            <div className="grid grid-cols-2 gap-2">
              <SelectField id="i-pose" label="Pose" value={a.pose3d ?? "front"} options={POSES} onChange={(v) => set({ pose3d: v })} />
              <SelectField id="i-finish" label="Finish" value={a.frameColor3d ?? "titanium"} options={[["titanium", "Titanium"], ["black", "Black"], ["white", "White"]] as const} onChange={(v) => set({ frameColor3d: v })} />
            </div>
          ) : (
            <ColorField id="i-frame" label="Frame colour" value={a.frameColor ?? ""} onChange={(v) => set({ frameColor: v || undefined })} />
          )}
          <AssetPicker label={localized ? `Screenshot (${locale})` : "Screenshot"} assets={assets.filter((x) => x.kind !== "recording")} value={localized ? override?.screenshotSrc ?? a.screenshotSrc : a.screenshotSrc}
            onPick={(src) => store.getState().apply({ type: "setScreenshot", ref: refr, src, locale: localized ? locale : undefined })} />
          <OverrideNote k="screenshotSrc" />
          <SelectField id="i-fit" label="Screenshot fit" value={a.screenshotObjectFit ?? "cover"} options={FITS} onChange={(v) => set({ screenshotObjectFit: v })} />
        </>
      )}

      {el.type === "video-device" && (
        <>
          <SelectField id="i-vdevice" label="Model" value={a.deviceType ?? "iphone-17-pro-max"} options={withCurrent(DEVICES, a.deviceType ?? "iphone-17-pro-max")} onChange={(v) => set({ deviceType: v })} />
          <AssetPicker label="Screen recording" assets={assets.filter((x) => x.kind === "recording")}
            value={(el as unknown as { videoSrc?: string }).videoSrc}
            onPick={(src) => set({ videoSrc: src, posterSrc: src ? `${src}#poster` : undefined } as never)} />
          <p className="text-xs text-neutral-500">Plays in preview videos; still exports show its first frame.</p>
        </>
      )}

      {el.type === "image" && (
        <>
          <AssetPicker label="Picture" assets={assets.filter((x) => x.kind !== "recording")} value={a.imageSrc} onPick={(src) => set({ imageSrc: src })} />
          <SelectField id="i-ifit" label="Fit" value={a.objectFit ?? "cover"} options={FITS} onChange={(v) => set({ objectFit: v })} />
          <NumberField id="i-iradius" label="Corner radius" value={Number(a.borderRadius ?? 0)} min={0} onChange={(v) => set({ borderRadius: Math.max(0, v) })} />
        </>
      )}

      <div className="grid grid-cols-2 gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <SelectField id="i-anim" label="Animation (video)" value={el.animation?.enter ?? "none"} options={ANIMATIONS}
          onChange={(v) => set({ animation: v === "none" ? undefined : { ...el.animation, enter: v } })} />
        <NumberField id="i-anim-delay" label="Delay (s)" value={el.animation?.enterDelay ?? 0} step={0.1} min={0} max={10}
          onChange={(v) => el.animation?.enter && set({ animation: { ...el.animation, enterDelay: Math.min(10, Math.max(0, v)) } })} />
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <NumberField id="i-x" label="X" value={el.position.x} onChange={(v) => set({ position: { ...el.position, x: v } })} />
        <NumberField id="i-y" label="Y" value={el.position.y} onChange={(v) => set({ position: { ...el.position, y: v } })} />
        <NumberField id="i-w" label="Width" value={sz.w} min={8} max={MAX_BOARD_EDGE} onChange={(v) => set({ size: { ...el.size, width: clampEdge(v) / (el.scale || 1) } })} />
        <NumberField id="i-h" label="Height" value={sz.h} min={8} max={MAX_BOARD_EDGE} onChange={(v) => set({ size: { ...el.size, height: clampEdge(v) / (el.scale || 1) } })} />
        <NumberField id="i-rot" label="Rotation" value={el.rotation || 0} onChange={(v) => set({ rotation: v })} />
        <NumberField id="i-op" label="Opacity %" value={Math.round((el.opacity ?? 1) * 100)} min={0} max={100} onChange={(v) => set({ opacity: Math.min(1, Math.max(0, v / 100)) })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-ghost" onClick={() => store.getState().apply({ type: "reorderElement", ref: refr, to: "front" })}>Bring to front</button>
        <button type="button" className="btn-ghost" onClick={() => store.getState().apply({ type: "reorderElement", ref: refr, to: "back" })}>Send to back</button>
        <button type="button" className="btn-ghost" onClick={() => duplicateSelection(store)}>Duplicate</button>
        <button type="button" className="btn-ghost text-red-600" onClick={() => store.getState().apply({ type: "deleteElements", refs: [refr] })}>Delete</button>
      </div>
      {refr.boardId !== null && (el.type === "text" || el.type === "device" || el.type === "video-device") && <LayoutPresets groupId={refr.groupId} boardId={refr.boardId} />}
    </div>
  );
}

export function duplicateSelection(store: ReturnType<typeof useEditorStore>) {
  const s = store.getState();
  if (!s.selection.length) return;
  const newIds = s.selection.map(() => crypto.randomUUID());
  s.apply({ type: "duplicateElements", refs: s.selection, newIds, offset: 40 });
  s.select(s.selection.map((r, i) => ({ ...r, elementId: newIds[i]! })));
}
