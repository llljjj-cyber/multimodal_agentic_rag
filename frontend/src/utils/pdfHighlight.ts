/** PDF 选区高亮：锚定在页面容器内，随滚动自然移动 */

const PAGE_HIGHLIGHT_CLASS = "pdf-page-highlight-layer";

export function ensurePageHighlightLayer(pageEl: HTMLElement): HTMLDivElement {
  let layer = pageEl.querySelector<HTMLDivElement>(`.${PAGE_HIGHLIGHT_CLASS}`);
  if (!layer) {
    layer = document.createElement("div");
    layer.className = PAGE_HIGHLIGHT_CLASS;
    layer.setAttribute("aria-hidden", "true");
    pageEl.appendChild(layer);
  }
  return layer;
}

export function clearAllPdfPageHighlights(root: HTMLElement | null) {
  root?.querySelectorAll(`.${PAGE_HIGHLIGHT_CLASS}`).forEach((node) => {
    node.replaceChildren();
  });
}

function findPageForRect(root: HTMLElement, rect: DOMRect): HTMLElement | null {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const pages = root.querySelectorAll<HTMLElement>(".pdfViewer .page");
  for (const page of pages) {
    const pr = page.getBoundingClientRect();
    if (cx >= pr.left && cx <= pr.right && cy >= pr.top && cy <= pr.bottom) {
      return page;
    }
  }
  return null;
}

export function paintPdfPageHighlights(range: Range, root: HTMLElement | null) {
  if (!root) return;
  clearAllPdfPageHighlights(root);

  const rects = range.getClientRects();
  const grouped = new Map<HTMLElement, DOMRect[]>();

  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i];
    if (r.width < 0.5 || r.height < 0.5) continue;
    const page = findPageForRect(root, r);
    if (!page) continue;
    const list = grouped.get(page) ?? [];
    list.push(r);
    grouped.set(page, list);
  }

  grouped.forEach((pageRects, page) => {
    const layer = ensurePageHighlightLayer(page);
    const pageRect = page.getBoundingClientRect();

    pageRects.forEach((r) => {
      const block = document.createElement("div");
      block.className = "reading-highlight-rect pdf-page-highlight-rect";
      block.style.top = `${r.top - pageRect.top}px`;
      block.style.left = `${r.left - pageRect.left}px`;
      block.style.width = `${r.width}px`;
      block.style.height = `${r.height}px`;
      layer.appendChild(block);
    });
  });
}

export function refreshPdfPageHighlights(range: Range, root: HTMLElement | null) {
  paintPdfPageHighlights(range, root);
}

export function isPdfTextSelection(range: Range) {
  const anchor = range.commonAncestorContainer;
  const el = anchor instanceof Element ? anchor : anchor.parentElement;
  return !!el?.closest(".pdfViewer .textLayer");
}
