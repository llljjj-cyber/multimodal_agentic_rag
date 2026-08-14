import {
  History,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Trash2,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { ChatMessage, Conversation } from "../api";
import MessageContent from "./MessageContent";

export type LayoutMode = "balanced" | "chat" | "warehouse";

const QUICK_PROMPTS = [
  { label: "巡视仓库", text: "请介绍一下我整个资料库的概况，包括有多少资料、什么类型。" },
  { label: "帮我找资料", text: "帮我查找与 Gemini Embedding 相关的资料。" },
  { label: "总结要点", text: "根据资料库内容，总结跨模态 Agentic RAG 的关键要点。" },
];

type Props = {
  layoutMode: LayoutMode;
  sourceCount: number;
  messages: ChatMessage[];
  draft: string;
  streamingText: string;
  isSending: boolean;
  conversations: Conversation[];
  activeConvId: number | null;
  conversationsLoading: boolean;
  deletingConvId: number | null;
  overlay?: boolean;
  companion?: boolean;
  onLayoutChange: (mode: LayoutMode) => void;
  onDraftChange: (value: string) => void;
  onSend: (text?: string) => void;
  onNewChat: () => void;
  onSelectConv: (id: number) => void;
  onDeleteConv: (id: number) => void;
  onClose?: () => void;
};

export default function ButlerPanel({
  layoutMode,
  sourceCount,
  messages,
  draft,
  streamingText,
  isSending,
  conversations,
  activeConvId,
  conversationsLoading,
  deletingConvId,
  overlay = false,
  companion = false,
  onLayoutChange,
  onDraftChange,
  onSend,
  onNewChat,
  onSelectConv,
  onDeleteConv,
  onClose,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const collapsed = layoutMode === "warehouse";

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, streamingText, isSending]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [draft]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || isSending) return;
    onSend();
  }

  if (collapsed) {
    return (
      <aside className="butler-rail" aria-label="Meridian 管家">
        <button
          type="button"
          className="butler-rail-avatar"
          title="展开 Meridian"
          onClick={() => onLayoutChange("balanced")}
        >
          <span aria-hidden>🧭</span>
        </button>
        <button type="button" className="butler-rail-btn" title="全屏对话" onClick={() => onLayoutChange("chat")}>
          <MessageSquare size={18} />
        </button>
        <div className="butler-rail-spacer" />
        <span className="butler-rail-label">M</span>
      </aside>
    );
  }

  return (
    <aside className={`butler-panel${layoutMode === "chat" ? " focus-chat" : ""}${overlay ? " butler-overlay" : ""}${companion ? " butler-companion" : ""}`}>
      <div className="butler-panel-inner">
      <header className="butler-header">
        <div className="butler-identity">
          <div className="butler-avatar" aria-hidden>🧭</div>
          <div>
            <h2>Meridian</h2>
            <p>{companion ? "伴读中 · 划词即可提问" : overlay ? "阅读模式 · 资料管家" : `您的资料管家 · ${sourceCount} 份资料`}</p>
          </div>
        </div>
        <div className="butler-header-tools">
          {companion || overlay ? (
            <button type="button" className="icon-btn" title="收起（Esc）" onClick={onClose}>
              <PanelLeftClose size={16} />
            </button>
          ) : layoutMode === "chat" ? (
            <button type="button" className="icon-btn active" title="退出全屏（Esc）" onClick={() => onLayoutChange("balanced")}>
              <PanelLeftClose size={16} />
            </button>
          ) : (
            <>
              <button type="button" className="icon-btn" title="收起管家" onClick={() => onLayoutChange("warehouse")}>
                <PanelLeftClose size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="全屏对话"
                onClick={() => onLayoutChange("chat")}
              >
                <PanelLeftOpen size={16} />
              </button>
            </>
          )}
        </div>
      </header>

      <details className="butler-history" open={historyOpen} onToggle={(e) => setHistoryOpen(e.currentTarget.open)}>
        <summary><History size={14} /> 对话记录</summary>
        <div className="butler-history-body">
          <button type="button" className="butler-new-chat" onClick={onNewChat}>+ 新话题</button>
          {conversationsLoading ? (
            <p className="butler-muted"><Loader2 className="spin" size={14} /> 加载中…</p>
          ) : conversations.length === 0 ? (
            <p className="butler-muted">还没有历史记录</p>
          ) : (
            conversations.map((conv) => (
              <div key={conv.id} className={`butler-history-row ${conv.id === activeConvId ? "active" : ""}`}>
                <button type="button" className="butler-history-btn" onClick={() => onSelectConv(conv.id)}>
                  {conv.title || `话题 #${conv.id}`}
                </button>
                <button type="button" className="icon-btn danger" disabled={deletingConvId === conv.id} onClick={() => onDeleteConv(conv.id)}>
                  {deletingConvId === conv.id ? <Loader2 className="spin" size={13} /> : <Trash2 size={13} />}
                </button>
              </div>
            ))
          )}
        </div>
      </details>

      <div className="butler-thread" ref={scrollRef}>
        {messages.length === 0 && !streamingText && !isSending && (
          <div className="butler-welcome">
            <p className="butler-welcome-lead">您好，我是 <strong>Meridian</strong> 🧭，您的资料管家。</p>
            <p className="butler-muted">
              {companion
                ? "我在旁边伴读。划选正文可翻译或提问，也可以直接跟我聊这份资料。"
                : overlay
                  ? "全屏阅读中。我可以解答文档内容、翻译划词，或帮您关联资料库中的其他资料。"
                  : layoutMode === "chat"
                    ? "全屏对话已开启。我可以帮您查找资料、根据文档回答，或巡视整个知识库。按 Esc 可回到仓库视图。"
                    : "仓库已就绪。我可以帮您查找资料、根据文档回答，或巡视整个知识库。左侧是您的立体资料空间。"}
            </p>
            <div className="butler-quick">
              {QUICK_PROMPTS.map((item) => (
                <button key={item.label} type="button" className="quick-chip" onClick={() => onSend(item.text)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <article key={msg.id} className={`butler-msg ${msg.role}`}>
            <header>{msg.role === "user" ? "🙂 您" : "🧭 Meridian"}</header>
            <div className="butler-msg-body">
              {msg.role === "assistant" ? <MessageContent content={msg.content} /> : <p>{msg.content}</p>}
            </div>
          </article>
        ))}

        {isSending && !streamingText && (
          <article className="butler-msg assistant streaming">
            <header>🧭 Meridian</header>
            <div className="butler-msg-body">
              <p className="butler-placeholder"><Loader2 className="spin" size={14} /> 正在巡视并整理资料…</p>
            </div>
          </article>
        )}

        {streamingText && (
          <article className="butler-msg assistant streaming">
            <header>🧭 Meridian</header>
            <div className="butler-msg-body">
              <MessageContent content={streamingText} streaming />
            </div>
          </article>
        )}
      </div>

      <form className="butler-composer" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="跟 Meridian 说…"
          rows={1}
          disabled={isSending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!draft.trim() || isSending) return;
              onSend();
            }
          }}
        />
        <button type="submit" className="butler-send" disabled={isSending || !draft.trim()} aria-label="发送">
          {isSending ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
        </button>
      </form>
      <p className="butler-composer-hint">
        Enter 发送 · Shift+Enter 换行
        {overlay ? " · Esc 关闭" : companion ? " · Esc 收起" : layoutMode === "chat" ? " · Esc 退出全屏" : ""}
      </p>
      </div>
    </aside>
  );
}

export { QUICK_PROMPTS };
