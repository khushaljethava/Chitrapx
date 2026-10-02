# Sub-project 6b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Spec:** `docs/superpowers/specs/2026-10-02-sp6b-screen-recordings-design.md`

## Review Focus
1. A recording referenced by a document but still processing must not break exports (poster or placeholder, never a crash).
2. A recording's derived paths must stay inside the workspace prefix.
3. Streaming verification must abort and remove the object as soon as the size limit is passed.

### Task 1: assets.meta, streaming completeUpload, recording kind and limits
### Task 2: process_recording worker job (ffmpeg, ffprobe) with tests
### Task 3: asset URL resolution for `asset:<id>` and `#poster`; renderer video in device frames with seek-aware readiness
### Task 4: web: recordings uploader on the app page, palette entry, inspector picker; e2e preview video with a recording
