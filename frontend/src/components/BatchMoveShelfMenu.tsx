import { FolderInput, Inbox } from "lucide-react";
import type { Shelf } from "../api";

type Props = {
  x: number;
  y: number;
  shelves: Shelf[];
  onMove: (shelfId: string | null) => void;
  onClose: () => void;
};

export default function BatchMoveShelfMenu({ x, y, shelves, onMove, onClose }: Props) {
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
        className="source-context-menu batch-move-menu"
        style={{ top: y, left: x }}
        role="menu"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="context-menu-title">移动到资料架</div>
        <button type="button" role="menuitem" onClick={() => onMove(null)}>
          <Inbox size={14} /> 未分类
        </button>
        {shelves.map((shelf) => (
          <button key={shelf.id} type="button" role="menuitem" onClick={() => onMove(shelf.id)}>
            <FolderInput size={14} /> {shelf.name}
          </button>
        ))}
      </div>
    </>
  );
}
