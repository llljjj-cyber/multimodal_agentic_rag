import { Loader2, MessageSquare, Plus, Trash2 } from "lucide-react";
import type { Conversation } from "../api";

type Props = {
  conversations: Conversation[];
  activeId: number | null;
  loading: boolean;
  deletingId: number | null;
  onSelect: (convId: number) => void;
  onNew: () => void;
  onDelete: (convId: number) => void;
};

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ConversationSidebar({
  conversations,
  activeId,
  loading,
  deletingId,
  onSelect,
  onNew,
  onDelete,
}: Props) {
  return (
    <aside className="conversation-sidebar panel">
      <div className="panel-heading conversation-sidebar-heading">
        <div>
          <h2>对话</h2>
          <p>多轮会话 · /chat/stream</p>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onNew}
          title="新对话"
          aria-label="新对话"
        >
          <Plus size={16} />
        </button>
      </div>

      {loading ? (
        <div className="conversation-sidebar-status">
          <Loader2 className="spin" size={16} />
          <span>加载会话…</span>
        </div>
      ) : conversations.length === 0 ? (
        <div className="empty-state conversation-sidebar-empty">
          还没有对话。发送第一条消息将自动创建会话。
        </div>
      ) : (
        <div className="conversation-list" role="list">
          {conversations.map((conv) => {
            const active = conv.id === activeId;
            const deleting = deletingId === conv.id;
            return (
              <div
                key={conv.id}
                className={`conversation-row ${active ? "active" : ""}`}
                role="listitem"
              >
                <button
                  type="button"
                  className="conversation-select"
                  onClick={() => onSelect(conv.id)}
                  aria-current={active ? "true" : undefined}
                >
                  <MessageSquare size={15} />
                  <span className="conversation-title">{conv.title || `会话 #${conv.id}`}</span>
                  <span className="conversation-meta">#{conv.id} · {formatWhen(conv.created_at)}</span>
                </button>
                <button
                  type="button"
                  className="icon-button conversation-delete"
                  onClick={() => onDelete(conv.id)}
                  disabled={deleting}
                  title="删除会话"
                  aria-label={`删除会话 ${conv.id}`}
                >
                  {deleting ? <Loader2 className="spin" size={14} /> : <Trash2 size={14} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
