import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  clearReadingHighlight,
  getStoredRangeRect,
  getStoredRangeText,
  hasActiveHighlight,
  refreshReadingHighlight,
  storeReadingHighlight,
} from "../utils/readingHighlight";

export type SelectionAnchor = {
  text: string;
  top: number;
  left: number;
  bottom: number;
};

type GestureState = {
  downX: number;
  downY: number;
  moved: boolean;
  scrollAt: number;
};

function rectToAnchor(rect: DOMRect, text: string): SelectionAnchor {
  return {
    text,
    top: rect.top,
    left: rect.left + rect.width / 2,
    bottom: rect.bottom,
  };
}

function nodeInRoot(node: Node, root: HTMLElement) {
  let current: Node | null = node;
  while (current) {
    if (current === root) return true;
    current = current.parentNode;
  }
  return false;
}

function unionFromRange(range: Range): DOMRect | null {
  const rects = range.getClientRects();
  if (rects.length === 0) {
    const single = range.getBoundingClientRect();
    return single.width || single.height ? single : null;
  }
  let top = Infinity;
  let left = Infinity;
  let bottom = -Infinity;
  let right = -Infinity;
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i];
    if (r.width < 0.5 && r.height < 0.5) continue;
    top = Math.min(top, r.top);
    left = Math.min(left, r.left);
    bottom = Math.max(bottom, r.bottom);
    right = Math.max(right, r.right);
  }
  if (!Number.isFinite(top)) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

function readLiveSelection(root: HTMLElement | null): { anchor: SelectionAnchor; range: Range } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;

  const text = sel.toString().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const range = sel.getRangeAt(0);
  if (!root) return null;

  const nodes = [range.commonAncestorContainer, range.startContainer, range.endContainer];
  if (!nodes.some((node) => nodeInRoot(node, root))) return null;

  const rect = unionFromRange(range);
  if (!rect) return null;

  return { anchor: rectToAnchor(rect, text), range };
}

export function useReadingSelection(
  rootRef: RefObject<HTMLElement | null>,
  scrollRef: RefObject<HTMLElement | null>,
  enabled = true,
) {
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);
  const activeRef = useRef(false);
  const gestureRef = useRef<GestureState>({ downX: 0, downY: 0, moved: false, scrollAt: 0 });
  const syncRafRef = useRef(0);

  const syncAnchorPosition = useCallback(() => {
    refreshReadingHighlight();
    const rect = getStoredRangeRect();
    const text = getStoredRangeText();
    if (!rect || !text) return;
    setAnchor(rectToAnchor(rect, text));
  }, []);

  const scheduleSync = useCallback(() => {
    cancelAnimationFrame(syncRafRef.current);
    syncRafRef.current = requestAnimationFrame(() => {
      syncAnchorPosition();
    });
  }, [syncAnchorPosition]);

  const dismiss = useCallback(() => {
    activeRef.current = false;
    clearReadingHighlight();
    setAnchor(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const capture = useCallback(
    (live: SelectionAnchor, range: Range) => {
      const root = rootRef.current;
      if (!root) return;

      const nodes = [range.commonAncestorContainer, range.startContainer, range.endContainer];
      if (!nodes.some((node) => nodeInRoot(node, root))) return;

      storeReadingHighlight(range, live.text, rootRef.current);
      requestAnimationFrame(() => {
        window.getSelection()?.removeAllRanges();
      });
      activeRef.current = true;
      setAnchor(live);
    },
    [rootRef],
  );

  useEffect(() => {
    if (!enabled) return;

    function onPointerDown(event: PointerEvent) {
      gestureRef.current.downX = event.clientX;
      gestureRef.current.downY = event.clientY;
      gestureRef.current.moved = false;
    }

    function onPointerMove(event: PointerEvent) {
      const g = gestureRef.current;
      if (Math.hypot(event.clientX - g.downX, event.clientY - g.downY) > 6) {
        g.moved = true;
      }
    }

    function onPointerUp(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (target instanceof Element && target.closest(".selection-popover")) return;
      if (target instanceof Element && target.closest(".reading-highlight-layer, .pdf-page-highlight-layer, .reading-content-highlight-layer")) return;

      window.setTimeout(() => {
        const root = rootRef.current;
        if (!root) return;

        const live = readLiveSelection(root);
        if (live) {
          capture(live.anchor, live.range);
          return;
        }

        if (activeRef.current) {
          if (target instanceof Element && target.closest(".selection-popover")) return;

          const g = gestureRef.current;
          const scrolledRecently = Date.now() - g.scrollAt < 300;
          if (g.moved || scrolledRecently) {
            scheduleSync();
            return;
          }

          dismiss();
        }
      }, 30);
    }

    function onScroll() {
      gestureRef.current.scrollAt = Date.now();
      if (activeRef.current && hasActiveHighlight()) scheduleSync();
    }

    function onResize() {
      if (activeRef.current && hasActiveHighlight()) scheduleSync();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && activeRef.current) dismiss();
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown);

    let scrollEl = scrollRef.current;
    scrollEl?.addEventListener("scroll", onScroll, { passive: true });

    const retryId = window.setTimeout(() => {
      const next = scrollRef.current;
      if (next && next !== scrollEl) {
        scrollEl?.removeEventListener("scroll", onScroll);
        scrollEl = next;
        scrollEl.addEventListener("scroll", onScroll, { passive: true });
      }
    }, 0);

    return () => {
      window.clearTimeout(retryId);
      cancelAnimationFrame(syncRafRef.current);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp);
      scrollEl?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [rootRef, scrollRef, enabled, capture, dismiss, scheduleSync]);

  useEffect(() => {
    if (!enabled) dismiss();
  }, [enabled, dismiss]);

  return { anchor, dismiss, syncAnchorPosition: scheduleSync };
}

export function getSelectionPortalRoot(): HTMLElement {
  return (document.fullscreenElement as HTMLElement | null) ?? document.body;
}
