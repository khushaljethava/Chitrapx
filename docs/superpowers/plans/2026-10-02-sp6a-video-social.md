# Sub-project 6a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Spec:** `docs/superpowers/specs/2026-10-02-sp6a-video-social-design.md`

## Review Focus
1. A board with a 3D device must still paint each frame before capture (readiness per frame).
2. ffmpeg missing or failing must fail the job with a clear error and refund, never hang.
3. Social project creation must respect plan limits.

### [x] Task 1: animation port + timeline (pure) with tests
### [x] Task 2: renderer `time` support and default motion
### [x] Task 3: video job (worker, render page video mode, ffmpeg), price, download route generalised; e2e test with ffprobe
### [x] Task 4: web: video panel with preview player and job list; inspector animation field; social images action
