import { ChevronLeft, ChevronRight, Loader2, Maximize2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";
import {
  getDocument,
  GlobalWorkerOptions,
  OutputScale,
  PixelsPerInch,
  setLayerDimensions,
  TextLayer,
} from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfjsWorker;

type Props = {
  url: string;
  onReady?: () => void;
};

type PageSlot = {
  pageNum: number;
  page: PDFPageProxy;
  viewport: PageViewport;
  outputScale: OutputScale;
};

const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const FIT_ZOOM_INDEX = ZOOM_STEPS.indexOf(1);
const PDF_TO_CSS = PixelsPerInch.PDF_TO_CSS_UNITS;
const MAX_PAGE_WIDTH = 540;
const RENDER_OVERSAMPLE = 1.5;

function createOutputScale(): OutputScale {
  const scale = new OutputScale();
  scale.sx *= RENDER_OVERSAMPLE;
  scale.sy *= RENDER_OVERSAMPLE;
  return scale;
}

function createPageShell(slot: PageSlot) {
  const { pageNum, viewport } = slot;
  const page = document.createElement("article");
  page.className = "page pdf-sheet pdf-sheet-placeholder";
  page.dataset.pageNumber = String(pageNum);
  page.dataset.rendered = "0";
  setLayerDimensions(page as HTMLDivElement, viewport);

  const label = document.createElement("span");
  label.className = "pdf-sheet-label";
  label.textContent = String(pageNum);

  const canvasWrapper = document.createElement("div");
  canvasWrapper.className = "canvasWrapper";

  const textLayer = document.createElement("div");
  textLayer.className = "textLayer";

  page.append(label, canvasWrapper, textLayer);
  return page;
}

async function paintPage(slot: PageSlot, pageEl: HTMLElement) {
  if (pageEl.dataset.rendered === "1") return;

  const { page, viewport, outputScale } = slot;
  const canvasWrapper = pageEl.querySelector(".canvasWrapper");
  const textLayerDiv = pageEl.querySelector(".textLayer") as HTMLDivElement | null;
  if (!canvasWrapper || !textLayerDiv) return;

  setLayerDimensions(pageEl as HTMLDivElement, viewport);
  setLayerDimensions(textLayerDiv, viewport);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法渲染 PDF");

  canvas.width = Math.floor(viewport.width * outputScale.sx);
  canvas.height = Math.floor(viewport.height * outputScale.sy);

  const textLayer = new TextLayer({
    textContentSource: page.streamTextContent({ includeMarkedContent: true }),
    container: textLayerDiv,
    viewport,
  });

  await Promise.all([
    page.render({
      canvasContext: ctx,
      viewport,
      canvas,
      transform:
        outputScale.sx !== 1 || outputScale.sy !== 1
          ? [outputScale.sx, 0, 0, outputScale.sy, 0, 0]
          : undefined,
    }).promise,
    textLayer.render(),
  ]);

  canvasWrapper.replaceChildren(canvas);
  pageEl.classList.remove("pdf-sheet-placeholder");
  pageEl.dataset.rendered = "1";
}

function fitWidthScale(page: PDFPageProxy, containerWidth: number) {
  const base = page.getViewport({ scale: PDF_TO_CSS });
  const targetWidth = Math.min(containerWidth, MAX_PAGE_WIDTH);
  return Math.max(targetWidth / base.width, 0.3);
}

export default function PdfViewer({ url, onReady }: Props) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const zoomIndexRef = useRef(FIT_ZOOM_INDEX);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const renderingRef = useRef(new Set<number>());
  const prevZoomRef = useRef(FIT_ZOOM_INDEX);

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [pageTotal, setPageTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(FIT_ZOOM_INDEX);
  const [renderedCount, setRenderedCount] = useState(0);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  zoomIndexRef.current = zoomIndex;

  const applyScaleFactor = useCallback((viewportScale: number) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.style.setProperty("--scale-factor", String(viewportScale));
    viewer.style.removeProperty("--total-scale-factor");
  }, []);

  const scrollToPage = useCallback((pageNum: number) => {
    const host = hostRef.current;
    if (!host) return;
    host.querySelector<HTMLElement>(`.page[data-page-number="${pageNum}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    setCurrentPage(pageNum);
  }, []);

  const rebuildLayout = useCallback(
    async (pdf: PDFDocumentProxy, zoomIdx: number) => {
      const host = hostRef.current;
      const viewer = viewerRef.current;
      const flow = viewer?.closest(".source-reader-body") as HTMLElement | null;
      if (!host || !viewer) return;

      const shell = viewer.closest(".source-reader-pdf-shell") as HTMLElement | null;
      const rawWidth = shell?.clientWidth ?? flow?.clientWidth ?? MAX_PAGE_WIDTH;
      const contentWidth = Math.min(MAX_PAGE_WIDTH, Math.max(280, rawWidth - 40));
      const probe = await pdf.getPage(1);
      const displayScale = fitWidthScale(probe, contentWidth) * ZOOM_STEPS[zoomIdx];
      const probeViewport = probe.getViewport({ scale: displayScale * PDF_TO_CSS });

      applyScaleFactor(probeViewport.scale);

      const pageNums = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
      const slots: PageSlot[] = await Promise.all(
        pageNums.map(async (pageNum) => {
          const page = pageNum === 1 ? probe : await pdf.getPage(pageNum);
          return {
            pageNum,
            page,
            viewport: page.getViewport({ scale: displayScale * PDF_TO_CSS }),
            outputScale: createOutputScale(),
          };
        }),
      );

      renderingRef.current.clear();
      host.replaceChildren();
      slots.forEach((slot) => host.appendChild(createPageShell(slot)));

      setPageTotal(slots.length);
      setRenderedCount(0);

      const slotByNum = new Map(slots.map((s) => [s.pageNum, s]));

      async function ensureRendered(pageNum: number, pageEl: HTMLElement) {
        if (pageEl.dataset.rendered === "1" || renderingRef.current.has(pageNum)) return;
        const slot = slotByNum.get(pageNum);
        if (!slot) return;
        renderingRef.current.add(pageNum);
        try {
          await paintPage(slot, pageEl);
          setRenderedCount((c) => c + 1);
        } finally {
          renderingRef.current.delete(pageNum);
        }
      }

      observerRef.current?.disconnect();
      observerRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const pageEl = entry.target as HTMLElement;
            const pageNum = Number(pageEl.dataset.pageNumber);
            if (Number.isFinite(pageNum)) void ensureRendered(pageNum, pageEl);
          });
        },
        { root: flow, rootMargin: "480px 0px", threshold: 0.01 },
      );

      host.querySelectorAll(".page").forEach((node) => observerRef.current!.observe(node));

      await Promise.all(
        Array.from(host.querySelectorAll<HTMLElement>(".page"))
          .slice(0, 2)
          .map((el) => ensureRendered(Number(el.dataset.pageNumber), el)),
      );
    },
    [applyScaleFactor],
  );

  useEffect(() => {
    if (!hostRef.current || !url) return;

    let cancelled = false;

    async function boot() {
      setPhase("loading");
      setError("");
      setPageTotal(0);
      setRenderedCount(0);
      setCurrentPage(1);

      try {
        const pdf = await getDocument({ url }).promise;
        if (cancelled) return;
        pdfRef.current = pdf;

        await rebuildLayout(pdf, zoomIndexRef.current);
        if (cancelled) return;

        onReadyRef.current?.();
        setPhase("ready");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "PDF 加载失败");
          setPhase("error");
        }
      }
    }

    void boot();
    return () => {
      cancelled = true;
      observerRef.current?.disconnect();
      pdfRef.current = null;
    };
  }, [url, rebuildLayout]);

  useEffect(() => {
    if (prevZoomRef.current === zoomIndex) return;
    prevZoomRef.current = zoomIndex;
    const pdf = pdfRef.current;
    if (!pdf || phase !== "ready") return;
    void rebuildLayout(pdf, zoomIndex);
  }, [zoomIndex, rebuildLayout, phase]);

  useEffect(() => {
    const scrollRoot = viewerRef.current?.closest(".source-reader-body") as HTMLElement | null;
    if (!scrollRoot || phase !== "ready") return;
    const root = scrollRoot;

    function onScroll() {
      const host = hostRef.current;
      if (!host) return;
      const mid = root.getBoundingClientRect().top + root.clientHeight * 0.38;
      let best = 1;
      let bestDist = Infinity;
      host.querySelectorAll<HTMLElement>(".page").forEach((page) => {
        const dist = Math.abs(page.getBoundingClientRect().top - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = Number(page.dataset.pageNumber) || 1;
        }
      });
      setCurrentPage(best);
    }

    root.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener("scroll", onScroll);
  }, [phase, pageTotal]);

  useEffect(() => {
    if (phase !== "ready") return;

    function onKeyDown(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        scrollToPage(Math.max(1, currentPage - 1));
      } else if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        scrollToPage(Math.min(pageTotal, currentPage + 1));
      } else if (event.key === "+" || event.key === "=") {
        setZoomIndex((z) => Math.min(ZOOM_STEPS.length - 1, z + 1));
      } else if (event.key === "-") {
        setZoomIndex((z) => Math.max(0, z - 1));
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, currentPage, pageTotal, scrollToPage]);

  function changeZoom(delta: number) {
    setZoomIndex((prev) => Math.max(0, Math.min(ZOOM_STEPS.length - 1, prev + delta)));
  }

  if (phase === "error") {
    return <p className="reader-state-msg error">{error}</p>;
  }

  const loading = phase === "loading";
  const buffering = phase === "ready" && renderedCount < pageTotal;

  return (
    <div className={`pdf-reader${loading ? " is-loading" : ""}`}>
      <div ref={viewerRef} className="pdfViewer pdf-flow">
        {loading && (
          <div className="pdf-reader-loading">
            <Loader2 className="spin" size={20} strokeWidth={1.5} />
            <span>正在打开 PDF…</span>
          </div>
        )}
        <div ref={hostRef} className="pdf-flow-pages" />
      </div>

      {!loading && (
        <div className="pdf-reader-dock" role="toolbar" aria-label="PDF 浏览控制">
          <div className="pdf-reader-dock-inner">
            <div className="pdf-dock-group">
              <button
                type="button"
                className="pdf-dock-btn"
                onClick={() => scrollToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                aria-label="上一页"
              >
                <ChevronLeft size={17} strokeWidth={1.75} />
              </button>
              <span className="pdf-dock-page">
                {pageTotal > 0 ? `${currentPage} / ${pageTotal}` : "—"}
              </span>
              <button
                type="button"
                className="pdf-dock-btn"
                onClick={() => scrollToPage(currentPage + 1)}
                disabled={currentPage >= pageTotal}
                aria-label="下一页"
              >
                <ChevronRight size={17} strokeWidth={1.75} />
              </button>
            </div>

            <span className="pdf-dock-divider" aria-hidden />

            <div className="pdf-dock-group">
              <button
                type="button"
                className="pdf-dock-btn"
                onClick={() => changeZoom(-1)}
                disabled={zoomIndex <= 0}
                aria-label="缩小"
              >
                <Minus size={16} strokeWidth={1.75} />
              </button>
              <span className="pdf-dock-zoom">{Math.round(ZOOM_STEPS[zoomIndex] * 100)}%</span>
              <button
                type="button"
                className="pdf-dock-btn"
                onClick={() => changeZoom(1)}
                disabled={zoomIndex >= ZOOM_STEPS.length - 1}
                aria-label="放大"
              >
                <Plus size={16} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className="pdf-dock-btn"
                onClick={() => setZoomIndex(FIT_ZOOM_INDEX)}
                aria-label="适合宽度"
                title="适合宽度"
              >
                <Maximize2 size={15} strokeWidth={1.75} />
              </button>
            </div>

            {buffering && (
              <>
                <span className="pdf-dock-divider" aria-hidden />
                <span className="pdf-dock-buffer">{renderedCount}/{pageTotal}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
