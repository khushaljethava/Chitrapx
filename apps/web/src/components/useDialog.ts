"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Where Tab (or Shift+Tab) moves among `count` controls from `current` (-1: focus is outside). Wraps around; -1 when there is nothing to focus. */
export function nextFocusIndex(count: number, current: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return shift ? count - 1 : 0;
  return (current + (shift ? -1 : 1) + count) % count;
}

/**
 * Modal dialog behaviour: focus moves in on open, Tab and Shift+Tab stay inside, Escape closes
 * (not while `canClose` is false), and focus returns to whatever had it before. Spread the
 * returned `onBackdrop` on the overlay so a click outside the panel closes too.
 */
export function useDialog(ref: RefObject<HTMLElement | null>, { onClose, canClose = true }: { onClose: () => void; canClose?: boolean }) {
  const latest = useRef({ onClose, canClose });
  useEffect(() => { latest.current = { onClose, canClose }; });

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!root.contains(document.activeElement)) (root.querySelector<HTMLElement>("[autofocus]") ?? items()[0] ?? root).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (latest.current.canClose) latest.current.onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = items();
      const next = nextFocusIndex(list.length, list.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      e.preventDefault();
      (next < 0 ? root : list[next]!).focus();
    };
    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [ref]);

  return {
    /** Closes when the click landed on the overlay itself, not inside the panel. */
    onBackdrop: (e: React.MouseEvent) => { if (e.target === e.currentTarget && latest.current.canClose) latest.current.onClose(); },
  };
}
