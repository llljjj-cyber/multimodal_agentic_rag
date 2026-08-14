import {
  clearAllPdfPageHighlights,
  isPdfTextSelection,
  paintPdfPageHighlights,
  refreshPdfPageHighlights,
} from "./pdfHighlight";

const HIGHLIGHT_NAME = "meridian-reading";
const CONTENT_HIGHLIGHT_CLASS = "reading-content-highlight-layer";

let storedRange: Range | null = null;
let storedText = "";
let overlayLayer: HTMLDivElement | null = null;
let pdfRoot: HTMLElement | null = null;
let proseRoot: HTMLElement | null = null;

function portalRoot() {
  return (document.fullscreenElement as HTMLElement | null) ?? document.body;
}

function supportsCssHighlight() {
  return typeof Highlight !== "undefined" && typeof CSS !== "undefined" && "highlights" in CSS;
}

function unionRect(range: Range): DOMRect | null {
  try {
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
  } catch {
    return null;
  }
}

function paintFixedOverlay(range: Range) {
  const rects = range.getClientRects();
  const nextLayer = document.createElement("div");
  nextLayer.className = "reading-highlight-layer";
  nextLayer.setAttribute("aria-hidden", "true");

  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i];
    if (r.width < 0.5 || r.height < 0.5) continue;
    const block = document.createElement("div");
    block.className = "reading-highlight-rect reading-highlight-rect--fixed";
    block.style.top = `${r.top}px`;
    block.style.left = `${r.left}px`;
    block.style.width = `${r.width}px`;
    block.style.height = `${r.height}px`;
    nextLayer.appendChild(block);
  }

  if (nextLayer.childElementCount === 0) return;

  overlayLayer?.remove();
  overlayLayer = nextLayer;
  portalRoot().appendChild(overlayLayer);
}

function ensureContentHighlightLayer(root: HTMLElement): HTMLDivElement {
  let layer = root.querySelector<HTMLDivElement>(`.${CONTENT_HIGHLIGHT_CLASS}`);
  if (!layer) {
    layer = document.createElement("div");
    layer.className = CONTENT_HIGHLIGHT_CLASS;
    layer.setAttribute("aria-hidden", "true");
    root.appendChild(layer);
  }
  return layer;
}

function clearContentOverlay(root: HTMLElement | null) {
  root?.querySelector(`.${CONTENT_HIGHLIGHT_CLASS}`)?.replaceChildren();
}

function paintContentOverlay(range: Range, root: HTMLElement) {
  const layer = ensureContentHighlightLayer(root);
  layer.replaceChildren();
  const rootRect = root.getBoundingClientRect();
  const rects = range.getClientRects();

  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i];
    if (r.width < 0.5 || r.height < 0.5) continue;
    const block = document.createElement("div");
    block.className = "reading-highlight-rect reading-highlight-rect--content";
    block.style.top = `${r.top - rootRect.top}px`;
    block.style.left = `${r.left - rootRect.left}px`;
    block.style.width = `${r.width}px`;
    block.style.height = `${r.height}px`;
    layer.appendChild(block);
  }
}

function applyCssHighlight(range: Range) {
  if (!supportsCssHighlight()) return;
  CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
}

function resolvePdfRoot(range: Range): HTMLElement | null {
  const anchor = range.commonAncestorContainer;
  const el = anchor instanceof Element ? anchor : anchor.parentElement;
  return el?.closest<HTMLElement>(".pdfViewer") ?? null;
}

function paintProseHighlight(range: Range, root: HTMLElement | null) {
  // MD/TXT 始终用 DOM overlay：CSS Highlight 在 clearSelection 后常会消失
  if (root) {
    paintContentOverlay(range, root);
    return;
  }
  paintFixedOverlay(range);
}

export function storeReadingHighlight(range: Range, text?: string, root?: HTMLElement | null) {
  clearReadingHighlight();
  storedRange = range.cloneRange();
  storedText =
    text ??
    storedRange
      .toString()
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  pdfRoot = resolvePdfRoot(storedRange);
  proseRoot = isPdfTextSelection(storedRange) ? null : (root ?? null);

  if (isPdfTextSelection(storedRange)) {
    if (supportsCssHighlight()) {
      applyCssHighlight(storedRange);
      return;
    }
    if (pdfRoot) {
      paintPdfPageHighlights(storedRange, pdfRoot);
    }
    return;
  }

  paintProseHighlight(storedRange, proseRoot);
}

export function refreshReadingHighlight() {
  if (!storedRange) return;
  if (isPdfTextSelection(storedRange)) {
    if (supportsCssHighlight()) {
      applyCssHighlight(storedRange);
      return;
    }
    if (pdfRoot) {
      refreshPdfPageHighlights(storedRange, pdfRoot);
    }
    return;
  }
  if (proseRoot) {
    paintContentOverlay(storedRange, proseRoot);
    return;
  }
  paintFixedOverlay(storedRange);
}

export function clearReadingHighlight() {
  storedRange = null;
  storedText = "";
  overlayLayer?.remove();
  overlayLayer = null;
  clearContentOverlay(proseRoot);
  clearAllPdfPageHighlights(pdfRoot);
  pdfRoot = null;
  proseRoot = null;
  if (supportsCssHighlight()) {
    CSS.highlights.delete(HIGHLIGHT_NAME);
  }
}

export function getStoredRange() {
  return storedRange;
}

export function getStoredRangeRect(): DOMRect | null {
  if (!storedRange) return null;
  return unionRect(storedRange);
}

export function getStoredRangeText() {
  return storedText;
}

export function hasActiveHighlight() {
  return storedRange != null;
}
