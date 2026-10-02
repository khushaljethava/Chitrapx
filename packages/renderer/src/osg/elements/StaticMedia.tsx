// Chitrapx: static stand-ins for OSG's video, video-device and gesture elements.
// Motion arrives with sub-project 6; until then boards show the poster frame.
import type {
  DeviceFrameElementProps, GestureElementProps, VideoDeviceElementProps, VideoElementProps,
} from "@chitrapx/document";
import { DeviceFrameElement } from "./DeviceFrameElement";

type Common = { onUpdate?: unknown; isSelected?: boolean };

export function VideoElement({ element }: { element: VideoElementProps } & Common) {
  const poster = (element as VideoElementProps & { posterSrc?: string }).posterSrc;
  return poster ? <img src={poster} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null;
}

/** A device frame playing its screen recording (the poster shows until it loads, and in 3D styles). */
export function VideoDeviceElement({ element, time }: { element: VideoDeviceElementProps; time?: number } & Common) {
  const src = (element as VideoDeviceElementProps & { videoSrc?: string }).videoSrc;
  const asDevice = {
    ...element, type: "device", screenshotSrc: element.posterSrc ?? src,
    screenshotRect: (element as { screenshotRect?: unknown }).screenshotRect ?? { left: 0, top: 0, width: 100, height: 100 },
  } as unknown as DeviceFrameElementProps;
  const flat = !/^3d-/.test((element as { styleType?: string }).styleType ?? "");
  return <DeviceFrameElement element={asDevice} onUpdate={() => {}} isSelected={false} videoSrc={flat ? src : undefined} videoTime={time} />;
}

export function GestureElement(_props: { element: GestureElementProps } & Common) {
  return null;
}
