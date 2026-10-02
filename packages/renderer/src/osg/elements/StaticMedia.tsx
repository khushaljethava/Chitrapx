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

export function VideoDeviceElement({ element }: { element: VideoDeviceElementProps } & Common) {
  const asDevice = { ...element, type: "device", screenshotSrc: element.posterSrc } as unknown as DeviceFrameElementProps;
  return <DeviceFrameElement element={asDevice} onUpdate={() => {}} isSelected={false} />;
}

export function GestureElement(_props: { element: GestureElementProps } & Common) {
  return null;
}
