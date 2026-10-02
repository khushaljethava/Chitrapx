# Sub-project 6a: Preview Videos from Boards, Social Formats

**Date:** 2026-10-02
**Status:** Derived from the approved architecture (main spec, A6 "Video"); built on the user's instruction "go for 6". Screen recordings inside device frames are sub-project 6b.
**Parent spec:** `2026-10-02-chitrapx-design.md`

## Goal

Turn a project's boards into an App Preview (or story) video with animated elements, and turn a design into social images in one click.

## Decisions

1. **Animation model:** OSG's `ElementAnimation` (enter/exit presets fade, slide up/down/left/right, scale-up, pop; delays and durations) and its `animationStateAt`, ported into the renderer. `StaticArtboard` takes an optional `time` (seconds) and applies the state as a CSS transform and opacity per element, so the editor, previews and export share one animation path.
2. **Default motion:** a board whose elements have no animations gets a tasteful default: texts slide up one after another (0.12 s apart), devices and images scale up after them. Elements with their own animation keep it.
3. **Timeline** (pure, `packages/document/src/video.ts`): boards play in order, `secondsPerBoard` each (2 to 6, default 3; a board's `previewDurationSeconds` overrides it), with a 0.4 s crossfade. Total length is clamped to Apple's App Preview limits of 15 to 30 seconds by stretching or trimming.
4. **Formats:** App Preview portrait 886x1920 and landscape 1920x886 (Apple's accepted iPhone 6.5/6.9 App Preview size), Instagram or TikTok story 1080x1920, square post 1080x1080. A board is scaled to the format; aspect differences are letterboxed with the board background.
5. **Rendering:** a `video` job (3 credits). The worker opens the signed render page in video mode, sets the viewport to the format, steps time at 30 fps through `window.__chitrapxSeek(t)`, waits for the frame to paint, captures JPEG frames and pipes them to ffmpeg: H.264 High profile, yuv420p, 30 fps, `+faststart`, plus a silent stereo AAC 256 kbps track. Stored in the `exports` bucket as `<workspace>/<job>.mp4`; downloaded through the existing job download route.
6. **Social images:** "Make social images" on the project page creates a new `social` project from the first board of the project's first size, retargeted to Instagram post, Instagram story, X post, LinkedIn post and Product Hunt gallery. It counts toward the plan's project limit and costs no credits.
7. **Editor:** each element gets an "Animation" field (preset, delay) in the inspector; the project page gets a video panel with a live preview player that uses the same timeline and renderer.

## Acceptance criteria

- `animationStateAt` matches OSG's behaviour (tests on fade, slide and pop at start, middle and end).
- The timeline for 3 boards at 3 s stretches to 15 s; 12 boards at 3 s trims to 30 s; crossfades never exceed half a slide.
- A video job for a 5-board project produces an MP4 that ffprobe reports as H.264, 886x1920, 30 fps, 15 to 30 s, with one AAC stereo track; a failed job refunds.
- "Make social images" produces a project with five groups at the exact social sizes.
