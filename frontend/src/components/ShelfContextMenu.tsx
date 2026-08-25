import { Pencil, Trash2 } from "lucide-react";

type Props = {
  x: number;
  y: number;
  name: string;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export default function ShelfContextMenu({ x, y, name, onRename, onDelete, onClose }: Props) {
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
        <div className="context-menu-title">{name}</div>
        <button type="button" role="menuitem" onClick={onRename}>
          <Pencil size={14} /> 重命名
        </button>
        <button type="button" role="menuitem" className="danger" onClick={onDelete}>
          <Trash2 size={14} /> 删除资料架
        </button>
      </div>
    </>
  );
}
