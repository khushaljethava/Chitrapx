# Sub-project 6b: Screen Recordings in Device Frames

**Date:** 2026-10-02
**Status:** Built on the user's instruction "build first" (review afterwards).
**Parent spec:** `2026-10-02-chitrapx-design.md`; extends `2026-10-02-sp6a-video-social-design.md`.

## Goal

A customer uploads a screen recording, places it in a device frame, and the preview video shows the app in motion inside the phone.

## Decisions

1. **Upload:** recordings are `video/mp4` or `video/quicktime`, up to 500 MB and 60 seconds. They use the same staged upload as screenshots, but `completeUpload` now **streams** every upload (hash, size, type sniffing on the first bytes) instead of buffering it, so memory stays constant for any file size. The `uploads` bucket limit rises to 500 MiB; per-kind limits stay enforced at sign and complete.
2. **Processing:** a free `process_recording` job (0 credits) runs ffmpeg in the worker: VP9 WebM (open codec that headless Chromium and current browsers play), at most 1080 px on the long edge, 30 fps, no audio, first 60 seconds; plus a JPEG poster from 0.5 s; duration and size from ffprobe. Results are stored next to the original (`<ws>/<sha>.webm`, `<ws>/<sha>.poster.jpg`) and recorded in a new `assets.meta` JSON column (`{ ready, webm, poster, duration, width, height }` or `{ ready: false, error }`).
3. **Document references:** a video device uses `videoSrc: "asset:<id>"` (resolves to the WebM) and `posterSrc: "asset:<id>#poster"` (resolves to the poster). Only processed recordings of the workspace resolve.
4. **Rendering:** the device frame shows a muted, inline `<video>` in its screen. With a `time` (video export, previews), the video seeks to that board-local time and the frame waits for the seek before capture; without one (editor), it loops. Still exports (PNG ZIP) show the poster. 3D device styles show the poster (motion in 3D is out of scope).
5. **Editor:** "Phone with recording" in the palette; the inspector for a recording device picks from the app's processed recordings.

## Acceptance criteria

- Uploading a 40 MB MP4 never holds it in server memory and creates one asset; a 600 MB file or a text file renamed `.mp4` is refused.
- After processing, the asset has a playable WebM, a poster, duration and size; a corrupt video ends with `ready: false` and an error, not a stuck job.
- A preview video of a board with a recording device shows different screen content at 0.5 s and 2.5 s.
- A still export shows the poster in the device screen.
