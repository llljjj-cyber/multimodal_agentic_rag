import { BookOpen, MessageSquare, Pencil, Trash2 } from "lucide-react";

type Props = {
  x: number;
  y: number;
  title: string;
  readable?: boolean;
  onOpen?: () => void;
  onAsk?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onClose: () => void;
};

export default function SourceContextMenu({
  x,
  y,
  title,
  readable,
  onOpen,
  onAsk,
  onRename,
  onDelete,
  onClose,
}: Props) {
  return (
    <>
      <div className="context-menu-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
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
        {onDelete && (
          <button type="button" role="menuitem" className="danger" onClick={onDelete}>
            <Trash2 size={14} /> 删除资料
          </button>
        )}
      </div>
    </>
  );
}
