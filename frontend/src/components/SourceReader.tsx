import { ArrowLeft, Loader2, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSourceFile, type SourceMeta } from "../api";
import { useReadingSelection } from "../hooks/useReadingSelection";
import MarkdownContent from "./MarkdownContent";
import PdfViewer from "./PdfViewer";
import SelectionPopover from "./SelectionPopover";

const MODALITY_LABELS: Record<string, string> = {
  pdf: "PDF",
  md: "Markdown",
  txt: "文本",
};

type Props = {
  token: string;
  source: SourceMeta;
  immersive?: boolean;
  onClose: () => void;
  onAsk: (text: string) => void;
  onOpenMeridian?: () => void;
};

export default function SourceReader({
  token,
  source,
  immersive = false,
  onClose,
  onAsk,
  onOpenMeridian,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState("");
  const [progress, setProgress] = useState(0);
  const [pdfReady, setPdfReady] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRootRef = useRef<HTMLDivElement | null>(null);

  const isPdf = source.modality === "pdf";
  const isMarkdown = source.modality === "md";
  const label = MODALITY_LABELS[source.modality] || source.modality.toUpperCase();

  const selectionEnabled =
    !loading && (isPdf ? pdfReady : textContent.length > 0);

  const { anchor, dismiss, syncAnchorPosition } = useReadingSelection(
    contentRootRef,
    scrollRef,
    selectionEnabled,
  );

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function load() {
      setLoading(true);
      setError("");
      setBlobUrl(null);
      setTextContent("");
      setProgress(0);
      setPdfReady(false);

      try {
        const blob = await fetchSourceFile(token, source.id);
        if (cancelled) return;
        if (isPdf) {
          objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
        } else {
          setTextContent(await blob.text());
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "无法加载文件");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, source.id, isPdf]);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const max = node.scrollHeight - node.clientHeight;
    setProgress(max > 0 ? Math.min(1, node.scrollTop / max) : 0);
    syncAnchorPosition();
  }, [syncAnchorPosition]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => node.removeEventListener("scroll", handleScroll);
  }, [handleScroll, loading, textContent, blobUrl, pdfReady]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function askMeridian(text: string) {
    onOpenMeridian?.();
    onAsk(text);
  }

  const readerModeClass = isPdf ? "pdf-mode" : "text-mode";

  return (
    <div
      className={[
        "source-reader",
        immersive ? "immersive" : "",
        readerModeClass,
      ].filter(Boolean).join(" ")}
    >
      <div className="reader-chrome-progress" aria-hidden>
        <div className="reader-chrome-progress-bar" style={{ width: `${progress * 100}%` }} />
      </div>

      {immersive ? (
        <button
          type="button"
          className="reading-back-fab"
          onClick={onClose}
          title="返回（Esc）"
          aria-label="返回仓库"
        >
          <ArrowLeft size={16} strokeWidth={1.75} />
        </button>
      ) : (
        <header className="source-reader-header">
          <button type="button" className="reader-header-back" onClick={onClose}>
            <ArrowLeft size={15} strokeWidth={1.75} />
            <span>返回</span>
          </button>
          <div className="source-reader-title">
            <span className={`reader-modality-tag ${source.modality}`}>{label}</span>
            <h2>{source.title}</h2>
          </div>
          <button
            type="button"
            className="reader-header-ask"
            onClick={() => askMeridian(`请讲解一下「${source.title}」中的要点`)}
          >
            <MessageSquare size={14} strokeWidth={1.75} />
            <span>问 Meridian</span>
          </button>
        </header>
      )}

      <div className="source-reader-body" ref={scrollRef}>
        {loading && (
          <div className="reader-state">
            <Loader2 className="spin" size={22} strokeWidth={1.5} />
            <p>正在打开资料…</p>
          </div>
        )}

        {!loading && error && (
          <div className="reader-state error">
            <p>{error}</p>
            <p className="reader-state-hint">若这是较早入库的资料，请重新上传后再试。</p>
          </div>
        )}

        {!loading && !error && isPdf && blobUrl && (
          <div className="source-reader-pdf-shell">
            {!immersive && (
              <div className="reader-inline-head pdf-inline-head">
                <span className={`reader-modality-tag ${source.modality}`}>{label}</span>
                <h1>{source.title}</h1>
              </div>
            )}
            <div
              className="source-reader-pdf-interactive reading-selectable"
              ref={contentRootRef}
            >
              <PdfViewer url={blobUrl} onReady={() => setPdfReady(true)} />
            </div>
          </div>
        )}

        {!loading && !error && !isPdf && (
          <div className="source-reader-column-wrap reading-selectable" ref={contentRootRef}>
            {!immersive && (
              <div className="reader-inline-head">
                <span className={`reader-modality-tag ${source.modality}`}>{label}</span>
                <h1>{source.title}</h1>
              </div>
            )}
            <article className="source-reader-column">
              {isMarkdown ? (
                <MarkdownContent content={textContent} />
              ) : (
                <div className="source-reader-prose">
                  {textContent.split(/\n{2,}/).map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              )}
            </article>
          </div>
        )}
      </div>

      {anchor && (
        <SelectionPopover
          token={token}
          sourceTitle={source.title}
          anchor={anchor}
          onAddToDraft={onAsk}
          onOpenMeridian={onOpenMeridian}
          onDismiss={dismiss}
        />
      )}
    </div>
  );
}
