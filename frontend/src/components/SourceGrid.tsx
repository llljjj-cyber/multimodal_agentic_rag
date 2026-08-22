import { BookOpen, Loader2, MessageSquare, MoreHorizontal, Plus, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { isSourceBusy, type SourceStatus } from "../api";

export type GridSource = {
  id: string;
  title: string;
  modality: string;
  summary: string;
  chunks: number;
  created_at?: string;
  status?: SourceStatus;
  error_message?: string | null;
  shelf_id?: string | null;
  shelf_name?: string | null;
};

type SortKey = "newest" | "title" | "modality";

type Props = {
  sources: GridSource[];
  selectedId: string | null;
  modalityLabels: Record<string, string>;
  readableModalities: Set<string>;
  emptyTitle?: string;
  emptyDesc?: string;
  onSelect: (source: GridSource) => void;
  onOpen: (source: GridSource) => void;
  onAsk: (source: GridSource) => void;
  onContextMenu: (source: GridSource, position: { x: number; y: number }) => void;
  onAddSource?: () => void;
  viewSwitch?: ReactNode;
};

function formatWhen(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function previewText(text: string, max = 120) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "暂无摘要";
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function footLabel(source: GridSource) {
  if (source.status === "failed") return source.error_message || "入库失败";
  if (isSourceBusy(source.status)) return "解析 / 向量化中…";
  const shelf = source.shelf_name || (source.shelf_id == null ? "未分类" : "");
  return shelf ? `${source.chunks} 片段 · ${shelf}` : `${source.chunks} 片段`;
}

export default function SourceGrid({
  sources,
  selectedId,
  modalityLabels,
  readableModalities,
  emptyTitle = "仓库还是空的",
  emptyDesc = "入库 PDF、Markdown 或文本，Meridian 会帮你整理成可检索的知识空间。",
  onSelect,
  onOpen,
  onAsk,
  onContextMenu,
  onAddSource,
  viewSwitch,
}: Props) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("newest");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = sources;
    if (q) {
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.summary.toLowerCase().includes(q) ||
          (modalityLabels[s.modality] ?? s.modality).toLowerCase().includes(q) ||
          (s.shelf_name ?? "").toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortKey === "title") return a.title.localeCompare(b.title, "zh-CN");
      if (sortKey === "modality") {
        const ma = modalityLabels[a.modality] ?? a.modality;
        const mb = modalityLabels[b.modality] ?? b.modality;
        return ma.localeCompare(mb, "zh-CN") || a.title.localeCompare(b.title, "zh-CN");
      }
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
    return sorted;
  }, [sources, query, sortKey, modalityLabels]);

  if (sources.length === 0) {
    return (
      <div className="source-grid-shell source-grid-shell--empty">
        {viewSwitch && <div className="source-grid-chrome">{viewSwitch}</div>}
        <div className="source-grid-empty">
          <div className="source-grid-empty-inner">
            <p className="source-grid-empty-title">{emptyTitle}</p>
            <p className="source-grid-empty-desc">{emptyDesc}</p>
            {onAddSource && (
              <button type="button" className="btn-ghost source-grid-empty-cta" onClick={onAddSource}>
                <Plus size={15} /> 开始入库
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="source-grid-shell">
      <div className="source-grid-chrome">
        <div className="source-grid-toolbar">
          <div className="source-grid-search">
            <Search size={15} strokeWidth={1.75} aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题、摘要或类型…"
              aria-label="搜索资料"
            />
          </div>
          <label className="source-grid-sort">
            <span>排序</span>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
              <option value="newest">最新入库</option>
              <option value="title">标题 A–Z</option>
              <option value="modality">类型</option>
            </select>
          </label>
          <span className="source-grid-count">
            {filtered.length === sources.length
              ? `${sources.length} 份`
              : `${filtered.length} / ${sources.length} 份`}
          </span>
        </div>
        {viewSwitch}
      </div>

      {filtered.length === 0 ? (
        <div className="source-grid-no-match">
          <p>没有匹配「{query}」的资料</p>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setQuery("")}>
            清除搜索
          </button>
        </div>
      ) : (
        <div className="source-grid" role="list">
          {filtered.map((source) => {
            const busy = isSourceBusy(source.status);
            const failed = source.status === "failed";
            const ready = !busy && !failed;
            const readable = readableModalities.has(source.modality) && ready;
            const label = modalityLabels[source.modality] ?? source.modality.toUpperCase();
            const when = formatWhen(source.created_at);
            const selected = selectedId === source.id;

            return (
              <article
                key={source.id}
                role="listitem"
                className={`source-grid-card${selected ? " selected" : ""}${readable ? " readable" : ""}${
                  busy ? " is-processing" : ""
                }${failed ? " is-failed" : ""}`}
                data-modality={source.modality}
                onClick={() => onSelect(source)}
                onDoubleClick={() => {
                  if (readable) onOpen(source);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onContextMenu(source, { x: e.clientX, y: e.clientY });
                }}
              >
                <div className="source-grid-card-accent" aria-hidden />
                <header className="source-grid-card-head">
                  <span className={`source-dot ${source.modality}`}>{label.slice(0, 2)}</span>
                  <div className="source-grid-card-meta">
                    <span className="source-grid-modality">{label}</span>
                    {when && <span className="source-grid-when">{when}</span>}
                  </div>
                  {busy && (
                    <span className="source-status busy">
                      <Loader2 size={11} className="spin" />
                      处理中
                    </span>
                  )}
                  {failed && <span className="source-status fail">失败</span>}
                  <button
                    type="button"
                    className="icon-btn source-grid-more"
                    title="更多操作"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      onContextMenu(source, { x: rect.left, y: rect.bottom + 4 });
                    }}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </header>

                <h3 className="source-grid-card-title">{source.title}</h3>
                <p className="source-grid-card-summary">{previewText(source.summary)}</p>

                <footer className="source-grid-card-foot">
                  <span className="source-grid-stat">{footLabel(source)}</span>
                  <div className="source-grid-quick">
                    {readable && (
                      <button
                        type="button"
                        className="source-grid-quick-btn"
                        title="打开阅读"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(source);
                        }}
                      >
                        <BookOpen size={14} strokeWidth={1.75} />
                      </button>
                    )}
                    {ready && (
                      <button
                        type="button"
                        className="source-grid-quick-btn"
                        title="问 Meridian"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAsk(source);
                        }}
                      >
                        <MessageSquare size={14} strokeWidth={1.75} />
                      </button>
                    )}
                  </div>
                </footer>
                {busy && (
                  <div className="source-card-progress" aria-hidden>
                    <span />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
