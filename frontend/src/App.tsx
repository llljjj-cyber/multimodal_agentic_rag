import { LayoutGrid, LogOut, MessageSquare, Package, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiFetch,
  deleteConversation,
  deleteSource,
  listConversations,
  listMessages,
  READABLE_MODALITIES,
  streamChat,
  type ChatMessage,
  type Conversation,
  type SourceMeta,
} from "./api";
import AuthScreen from "./components/AuthScreen";
import ButlerPanel, { type LayoutMode } from "./components/ButlerPanel";
import ConfirmDialog from "./components/ConfirmDialog";
import LibrarySheet from "./components/LibrarySheet";
import RenameSourceDialog from "./components/RenameSourceDialog";
import SourceContextMenu from "./components/SourceContextMenu";
import SourceGrid from "./components/SourceGrid";
import SourceHoverCard from "./components/SourceHoverCard";
import SourceReader from "./components/SourceReader";
import SpaceCanvas, { type SpacePoint } from "./components/SpaceCanvas";
import WarehouseViewSwitch, { type WarehouseView } from "./components/WarehouseViewSwitch";

const TOKEN_KEY = "mar2_access_token";
const USER_KEY = "mar2_username";
const WAREHOUSE_VIEW_KEY = "mar2_warehouse_view";

function readWarehouseView(): WarehouseView {
  return localStorage.getItem(WAREHOUSE_VIEW_KEY) === "grid" ? "grid" : "spatial";
}

type RackSource = {
  id: string;
  title: string;
  modality: string;
  summary: string;
  chunks: number;
  created_at?: string;
};

type SpaceSnapshot = {
  sources: RackSource[];
  points: SpacePoint[];
  provider: string;
  dimensions: number;
};

const MODALITY_LABELS: Record<string, string> = {
  text: "文本", url: "网页", pdf: "PDF", txt: "TXT", md: "Markdown", query: "查询",
};

function normalizeSpace(data: unknown): SpaceSnapshot {
  const p = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const sourcesRaw = Array.isArray(p.sources) ? p.sources : [];
  return {
    sources: sourcesRaw.map((item) => {
      const s = (item ?? {}) as Record<string, unknown>;
      return {
        id: String(s.id ?? ""),
        title: String(s.title ?? ""),
        modality: String(s.modality ?? "text"),
        summary: String(s.summary ?? ""),
        chunks: typeof s.chunks === "number" ? s.chunks : typeof s.chunk_count === "number" ? s.chunk_count : 0,
        created_at: typeof s.created_at === "string" ? s.created_at : undefined,
      };
    }),
    points: (Array.isArray(p.points) ? p.points : []) as SpacePoint[],
    provider: String(p.provider ?? p.embedding_model ?? "未知"),
    dimensions: typeof p.dimensions === "number" ? p.dimensions : 1024,
  };
}

function formatWhen(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function pointMetaLine(point: SpacePoint, sources: RackSource[]) {
  const modality = MODALITY_LABELS[point.modality] || point.modality;
  if (point.modality === "query") return modality;
  const source = sources.find((item) => item.id === point.source_id);
  if (source?.created_at) {
    const when = formatWhen(source.created_at);
    return when ? `${modality} · ${when}` : modality;
  }
  return modality;
}

function Workspace({ token, username, onLogout }: { token: string; username: string; onLogout: () => void }) {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("balanced");
  const [warehouseView, setWarehouseView] = useState<WarehouseView>(readWarehouseView);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [space, setSpace] = useState<SpaceSnapshot | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<SpacePoint | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<SpacePoint | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ point: SpacePoint; x: number; y: number } | null>(null);
  const [pendingDeleteSourceId, setPendingDeleteSourceId] = useState<string | null>(null);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<SpacePoint | null>(null);
  const [readingSource, setReadingSource] = useState<SourceMeta | null>(null);
  const [meridianCompanionOpen, setMeridianCompanionOpen] = useState(true);
  const readingShellRef = useRef<HTMLDivElement | null>(null);
  const exitingFullscreenRef = useRef(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [deletingConvId, setDeletingConvId] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const sourceCount = space?.sources.length ?? 0;
  const isReading = readingSource != null;
  const isReadingRef = useRef(isReading);
  isReadingRef.current = isReading;
  const pendingDelete = conversations.find((c) => c.id === pendingDeleteId) ?? null;
  const pendingDeleteSource = space?.sources.find((s) => s.id === pendingDeleteSourceId) ?? null;
  const cardPoint = selectedPoint ?? hoveredPoint;
  const cardPosition = selectedPoint
    ? undefined
    : hoverPosition
      ? { top: hoverPosition.y + 12, left: hoverPosition.x + 12 }
      : undefined;

  const handleAuthFailure = useCallback(
    (err: unknown) => {
      if (err && typeof err === "object" && "status" in err && (err as { status?: number }).status === 401) {
        onLogout();
      }
    },
    [onLogout],
  );

  const refreshSpace = useCallback(async () => {
    const data = await apiFetch<{ space?: unknown }>("/space", token);
    setSpace(normalizeSpace(data));
  }, [token]);

  const refreshConversations = useCallback(async () => {
    setConversationsLoading(true);
    try {
      setConversations(await listConversations(token));
    } catch (err) {
      handleAuthFailure(err);
    } finally {
      setConversationsLoading(false);
    }
  }, [token, handleAuthFailure]);

  const loadMessages = useCallback(
    async (convId: number) => {
      setMessagesLoading(true);
      try {
        setMessages(await listMessages(token, convId));
      } catch (err) {
        handleAuthFailure(err);
        setMessages([]);
      } finally {
        setMessagesLoading(false);
      }
    },
    [token, handleAuthFailure],
  );

  useEffect(() => {
    refreshSpace().catch(handleAuthFailure);
  }, [refreshSpace, handleAuthFailure]);

  useEffect(() => {
    refreshConversations().catch(() => undefined);
  }, [refreshConversations]);

  useEffect(() => {
    if (activeConvId == null) { setMessages([]); return; }
    loadMessages(activeConvId).catch(() => undefined);
  }, [activeConvId, loadMessages]);

  useEffect(() => {
    if (!isReading) return;
    const el = readingShellRef.current;
    if (!el) return;

    void el.requestFullscreen().catch(() => undefined);

    function onFullscreenChange() {
      if (exitingFullscreenRef.current) return;
      if (isReadingRef.current && document.fullscreenElement !== el) {
        setReadingSource(null);
        setMeridianCompanionOpen(true);
      }
    }

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      exitingFullscreenRef.current = true;
      if (document.fullscreenElement === el) {
        void document.exitFullscreen().catch(() => undefined);
      }
      queueMicrotask(() => {
        exitingFullscreenRef.current = false;
      });
    };
  }, [isReading]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (isReading) {
          event.preventDefault();
          setMeridianCompanionOpen((open) => !open);
        }
        return;
      }
      if (event.key === "Escape") {
        if (isReading && meridianCompanionOpen) {
          setMeridianCompanionOpen(false);
          return;
        }
        if (readingSource) {
          closeReader();
          return;
        }
        if (layoutMode === "chat") setLayoutMode("balanced");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [layoutMode, readingSource, meridianCompanionOpen, isReading]);

  function openReader(source: SourceMeta | RackSource) {
    if (!READABLE_MODALITIES.has(source.modality)) return;
    setReadingSource({
      id: source.id,
      title: source.title,
      modality: source.modality,
      summary: "summary" in source ? source.summary : undefined,
      created_at: "created_at" in source ? source.created_at : undefined,
    });
    setSelectedPoint(null);
    setMeridianCompanionOpen(true);
  }

  function closeReader() {
    exitingFullscreenRef.current = true;
    setReadingSource(null);
    setMeridianCompanionOpen(true);
    if (readingShellRef.current && document.fullscreenElement === readingShellRef.current) {
      void document.exitFullscreen().catch(() => undefined);
    }
    queueMicrotask(() => {
      exitingFullscreenRef.current = false;
    });
  }

  function handleAskFromReader(text: string) {
    setDraft(text);
    setMeridianCompanionOpen(true);
  }

  function persistWarehouseView(view: WarehouseView) {
    setWarehouseView(view);
    localStorage.setItem(WAREHOUSE_VIEW_KEY, view);
  }

  function askAboutPoint(point: SpacePoint) {
    setDraft(`请介绍一下「${point.title}」`);
    setContextMenu(null);
    if (layoutMode === "warehouse") setLayoutMode("balanced");
  }

  function askAboutSource(source: RackSource) {
    setDraft(`请介绍一下「${source.title}」`);
    setContextMenu(null);
    if (layoutMode === "warehouse") setLayoutMode("balanced");
  }

  function handleGridSelect(source: RackSource) {
    const point = space?.points.find((p) => p.source_id === source.id) ?? null;
    handleSelectPoint(point);
  }

  function handleGridContextMenu(source: RackSource, position: { x: number; y: number }) {
    const point = space?.points.find((p) => p.source_id === source.id);
    if (!point) return;
    handlePointContextMenu(point, position);
  }

  function openReaderFromPoint(point: SpacePoint) {
    const src = space?.sources.find((s) => s.id === point.source_id);
    if (src) openReader(src);
    setContextMenu(null);
  }

  function handlePointContextMenu(point: SpacePoint, position: { x: number; y: number }) {
    setSelectedPoint(point);
    setContextMenu({ point, x: position.x, y: position.y });
  }

  async function confirmDeleteSource() {
    if (!pendingDeleteSourceId) return;
    const sourceId = pendingDeleteSourceId;
    setDeletingSourceId(sourceId);
    try {
      await deleteSource(token, sourceId);
      setPendingDeleteSourceId(null);
      setContextMenu(null);
      if (selectedPoint?.source_id === sourceId) setSelectedPoint(null);
      if (hoveredPoint?.source_id === sourceId) setHoveredPoint(null);
      if (readingSource?.id === sourceId) closeReader();
      await refreshSpace();
    } catch (err) {
      handleAuthFailure(err);
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeletingSourceId(null);
    }
  }

  async function sendMessage(text?: string) {
    const msg = (text ?? draft).trim();
    if (!msg || isSending) return;

    if (!isReading && layoutMode === "warehouse") setLayoutMode("balanced");
    if (isReading) setMeridianCompanionOpen(true);

    setIsSending(true);
    setError("");
    setStreamingText("");
    setDraft("");

    const optimistic: ChatMessage = {
      id: -Date.now(),
      role: "user",
      content: msg,
      created_at: new Date().toISOString(),
    };
    setMessages((cur) => [...cur, optimistic]);

    let nextConvId = activeConvId;
    let assembled = "";

    try {
      await streamChat(token, { message: msg, conv_id: activeConvId }, (payload) => {
        if (payload.kind === "conv_id") {
          nextConvId = payload.convId;
          setActiveConvId(payload.convId);
        } else if (payload.kind === "text") {
          assembled += payload.text;
          setStreamingText(assembled);
        }
      });

      if (assembled.trim()) {
        setStreamingText("");
        setMessages((cur) => [
          ...cur,
          { id: -(Date.now() + 1), role: "assistant", content: assembled, created_at: new Date().toISOString() },
        ]);
      } else {
        setStreamingText("");
      }

      if (nextConvId != null) {
        await loadMessages(nextConvId);
        await refreshConversations();
      }
    } catch (err) {
      handleAuthFailure(err);
      setError(err instanceof Error ? err.message : "发送失败");
      if (activeConvId == null) {
        setMessages((cur) => cur.filter((m) => m.id !== optimistic.id));
      }
    } finally {
      setStreamingText("");
      setIsSending(false);
    }
  }

  function handleSelectPoint(point: SpacePoint | null) {
    setSelectedPoint(point);
    if (point && point.modality !== "query") {
      setDraft(`请介绍一下「${point.title}」`);
    }
  }

  function handleHoverPoint(point: SpacePoint | null, position?: { x: number; y: number }) {
    if (selectedPoint) return;
    setHoveredPoint(point);
    setHoverPosition(position ?? null);
  }

  function startNewChat() {
    setActiveConvId(null);
    setMessages([]);
    setDraft("");
    setStreamingText("");
  }

  function requestDeleteConv(convId: number) {
    setPendingDeleteId(convId);
  }

  async function confirmDeleteConv() {
    if (pendingDeleteId == null) return;
    const convId = pendingDeleteId;
    setDeletingConvId(convId);
    try {
      await deleteConversation(token, convId);
      setPendingDeleteId(null);
      if (activeConvId === convId) startNewChat();
      await refreshConversations();
    } catch (err) {
      handleAuthFailure(err);
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeletingConvId(null);
    }
  }

  return (
    <div className={`vault-shell${isReading ? " is-reading" : ""}`}>
      {!isReading && (
        <header className="vault-topbar">
          <div className="vault-brand">
            <h1>资料<em>仓库</em></h1>
            <p>
              {sourceCount > 0
                ? `${sourceCount} 份资料 · 知识空间已就绪`
                : "开始入库，构建你的知识空间"}
            </p>
          </div>
          <div className="vault-toolbar">
            <div className="layout-switch" role="group" aria-label="布局模式">
              <button type="button" className={layoutMode === "balanced" ? "active" : ""} onClick={() => setLayoutMode("balanced")} title="均衡">
                <LayoutGrid size={15} /> 均衡
              </button>
              <button type="button" className={layoutMode === "chat" ? "active" : ""} onClick={() => setLayoutMode("chat")} title="全屏对话">
                <MessageSquare size={15} /> 对话
              </button>
              <button type="button" className={layoutMode === "warehouse" ? "active" : ""} onClick={() => setLayoutMode("warehouse")} title="专注仓库">
                <Package size={15} /> 仓库
              </button>
            </div>
            <span className="meta-chip">🙂 {username}</span>
            <span className="meta-chip">{sourceCount} 资料</span>
            <button type="button" className="btn-ghost" onClick={() => setLibraryOpen(true)}>
              <Plus size={15} /> 入库
            </button>
            <button type="button" className="icon-btn" onClick={onLogout} title="退出"><LogOut size={16} /></button>
          </div>
        </header>
      )}

      {error && !isReading && <div className="error-toast" role="alert">{error}</div>}

      {!isReading && (
      <div className={`vault-workspace mode-${layoutMode}`}>
        {layoutMode !== "chat" && (
          <section className={`warehouse-stage view-${warehouseView}`}>
              {warehouseView === "spatial" ? (
                <>
                  <SpaceCanvas
                    points={space?.points ?? []}
                    queryPoint={null}
                    highlightSourceIds={new Set()}
                    selectedId={selectedPoint?.id ?? null}
                    hoveredId={hoveredPoint?.id ?? null}
                    onSelect={handleSelectPoint}
                    onHover={handleHoverPoint}
                    onContextMenu={handlePointContextMenu}
                    viewSwitch={
                      <WarehouseViewSwitch
                        variant="canvas"
                        value={warehouseView}
                        onChange={persistWarehouseView}
                      />
                    }
                  />
                  {cardPoint && cardPoint.modality !== "query" && (
                    <SourceHoverCard
                      point={cardPoint}
                      metaLine={pointMetaLine(cardPoint, space?.sources ?? [])}
                      readable={READABLE_MODALITIES.has(cardPoint.modality)}
                      pinned={Boolean(selectedPoint)}
                      style={
                        cardPosition
                          ? {
                              position: "fixed",
                              top: Math.min(cardPosition.top, window.innerHeight - 220),
                              left: Math.min(cardPosition.left, window.innerWidth - 300),
                              width: 280,
                              zIndex: 20,
                            }
                          : undefined
                      }
                      onOpen={
                        READABLE_MODALITIES.has(cardPoint.modality)
                          ? () => openReaderFromPoint(cardPoint)
                          : undefined
                      }
                      onAsk={() => askAboutPoint(cardPoint)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        handlePointContextMenu(cardPoint, { x: event.clientX, y: event.clientY });
                      }}
                    />
                  )}
                  {sourceCount > 0 && sourceCount < 2 && (
                    <div className="warehouse-hint">再添加几份资料，空间会更清晰。点击右上角「入库」开始。</div>
                  )}
                </>
              ) : (
                <SourceGrid
                  sources={space?.sources ?? []}
                  selectedId={selectedPoint?.source_id ?? null}
                  modalityLabels={MODALITY_LABELS}
                  readableModalities={READABLE_MODALITIES}
                  onSelect={handleGridSelect}
                  onOpen={openReader}
                  onAsk={askAboutSource}
                  onContextMenu={handleGridContextMenu}
                  onAddSource={() => setLibraryOpen(true)}
                  viewSwitch={
                    <WarehouseViewSwitch
                      variant="toolbar"
                      value={warehouseView}
                      onChange={persistWarehouseView}
                    />
                  }
                />
              )}
              {contextMenu && (
                <SourceContextMenu
                  x={contextMenu.x}
                  y={contextMenu.y}
                  title={contextMenu.point.title}
                  readable={READABLE_MODALITIES.has(contextMenu.point.modality)}
                  onOpen={
                    READABLE_MODALITIES.has(contextMenu.point.modality)
                      ? () => openReaderFromPoint(contextMenu.point)
                      : undefined
                  }
                  onAsk={() => askAboutPoint(contextMenu.point)}
                  onRename={() => {
                    setRenameTarget(contextMenu.point);
                    setContextMenu(null);
                  }}
                  onDelete={() => {
                    setPendingDeleteSourceId(contextMenu.point.source_id);
                    setContextMenu(null);
                  }}
                  onClose={() => setContextMenu(null)}
                />
              )}
          </section>
        )}

        <ButlerPanel
          layoutMode={layoutMode}
          sourceCount={sourceCount}
          messages={messages}
          draft={draft}
          streamingText={streamingText}
          isSending={isSending || messagesLoading}
          conversations={conversations}
          activeConvId={activeConvId}
          conversationsLoading={conversationsLoading}
          deletingConvId={deletingConvId}
          onLayoutChange={setLayoutMode}
          onDraftChange={setDraft}
          onSend={sendMessage}
          onNewChat={startNewChat}
          onSelectConv={setActiveConvId}
          onDeleteConv={requestDeleteConv}
        />
      </div>
      )}

      {isReading && readingSource && (
        <div className="reading-shell" ref={readingShellRef}>
          <div className={`reading-split${meridianCompanionOpen ? " with-companion" : ""}`}>
            <div className="reading-main">
              <SourceReader
                token={token}
                source={readingSource}
                immersive
                onClose={closeReader}
                onAsk={handleAskFromReader}
                onOpenMeridian={() => setMeridianCompanionOpen(true)}
              />
            </div>

            {meridianCompanionOpen && (
              <aside className="reading-companion" aria-label="Meridian 伴读">
                <ButlerPanel
                  companion
                  layoutMode="balanced"
                  sourceCount={sourceCount}
                  messages={messages}
                  draft={draft}
                  streamingText={streamingText}
                  isSending={isSending || messagesLoading}
                  conversations={conversations}
                  activeConvId={activeConvId}
                  conversationsLoading={conversationsLoading}
                  deletingConvId={deletingConvId}
                  onLayoutChange={setLayoutMode}
                  onDraftChange={setDraft}
                  onSend={sendMessage}
                  onNewChat={startNewChat}
                  onSelectConv={setActiveConvId}
                  onDeleteConv={requestDeleteConv}
                  onClose={() => setMeridianCompanionOpen(false)}
                />
              </aside>
            )}
          </div>

          {!meridianCompanionOpen && (
            <button
              type="button"
              className="meridian-fab"
              title="唤起 Meridian 伴读（Ctrl+K）"
              onClick={() => setMeridianCompanionOpen(true)}
            >
              <span aria-hidden>🧭</span>
              <span>Meridian</span>
            </button>
          )}

          {error && <div className="error-toast reading-error-toast" role="alert">{error}</div>}
        </div>
      )}

      <LibrarySheet
        open={libraryOpen}
        token={token}
        onClose={() => setLibraryOpen(false)}
        onUpdated={() => refreshSpace().catch(handleAuthFailure)}
        onOpenReader={(source) => {
          setLibraryOpen(false);
          openReader(source);
        }}
      />

      <ConfirmDialog
        open={pendingDeleteId != null}
        title="删除这段对话？"
        description={`「${pendingDelete?.title || `话题 #${pendingDeleteId}`}」删除后无法恢复。`}
        confirmLabel="删除"
        busy={deletingConvId != null}
        onCancel={() => {
          if (deletingConvId == null) setPendingDeleteId(null);
        }}
        onConfirm={() => {
          void confirmDeleteConv();
        }}
      />

      <ConfirmDialog
        open={pendingDeleteSourceId != null}
        title="删除这份资料？"
        description={`「${pendingDeleteSource?.title || pendingDeleteSourceId}」将从仓库与向量索引中移除，无法恢复。`}
        confirmLabel="删除"
        busy={deletingSourceId != null}
        onCancel={() => {
          if (deletingSourceId == null) setPendingDeleteSourceId(null);
        }}
        onConfirm={() => {
          void confirmDeleteSource();
        }}
      />

      <RenameSourceDialog
        open={renameTarget != null}
        currentTitle={renameTarget?.title ?? ""}
        disabled
        disabledHint="修改标题需要后端 PATCH /sources/{id} 接口，暂未启用。如需此功能请告知，我可补充后端。"
        onCancel={() => setRenameTarget(null)}
        onConfirm={() => setRenameTarget(null)}
      />
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [username, setUsername] = useState(() => localStorage.getItem(USER_KEY) || "");

  function handleAuth(accessToken: string, user: string) {
    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(USER_KEY, user);
    setToken(accessToken);
    setUsername(user);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUsername("");
  }

  if (!token) return <AuthScreen onAuth={handleAuth} />;
  return <Workspace token={token} username={username} onLogout={logout} />;
}
