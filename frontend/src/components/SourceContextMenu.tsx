import { BookOpen, FolderInput, Inbox, MessageSquare, Pencil, Trash2 } from "lucide-react";
import type { Shelf } from "../api";

type Props = {
  x: number;
  y: number;
  title: string;
  readable?: boolean;
  currentShelfId?: string | null;
  shelves: Shelf[];
  onOpen?: () => void;
  onAsk?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onMoveToShelf?: (shelfId: string | null) => void;
  onClose: () => void;
};

export default function SourceContextMenu({
  x,
  y,
  title,
  readable,
  currentShelfId = null,
  shelves,
  onOpen,
  onAsk,
  onRename,
  onDelete,
  onMoveToShelf,
  onClose,
}: Props) {
  return (
    <>
      <div
        className="context-menu-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="source-context-menu"
        style={{ top: y, left: x }}
        role="menu"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="context-menu-title">{title}</div>
        {readable && onOpen && (
          <button type="button" role="menuitem" onClick={onOpen}>
            <BookOpen size={14} /> 打开阅读
          </button>
        )}
        {onAsk && (
          <button type="button" role="menuitem" onClick={onAsk}>
            <MessageSquare size={14} /> 问 Meridian
          </button>
        )}
        {onRename && (
          <button type="button" role="menuitem" onClick={onRename}>
            <Pencil size={14} /> 修改标题
          </button>
        )}
        {onMoveToShelf && (
          <>
            <div className="context-menu-title" style={{ marginTop: 4 }}>
              移到资料架
            </div>
            <button type="button" role="menuitem" onClick={() => onMoveToShelf(null)}>
              <Inbox size={14} /> 未分类{currentShelfId == null ? " · 当前" : ""}
            </button>
            {shelves.map((shelf) => (
              <button
                key={shelf.id}
                type="button"
                role="menuitem"
                onClick={() => onMoveToShelf(shelf.id)}
              >
                <FolderInput size={14} /> {shelf.name}
                {currentShelfId === shelf.id ? " · 当前" : ""}
              </button>
            ))}
          </>
        )}
        {onDelete && (
          <button type="button" role="menuitem" className="danger" onClick={onDelete}>
            <Trash2 size={14} /> 删除资料
          </button>
        )}
      </div>
    </>
  );
}
