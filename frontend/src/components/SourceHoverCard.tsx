import { BookOpen, MessageSquare, MoreHorizontal } from "lucide-react";
import type { SpacePoint } from "./SpaceCanvas";

type Props = {
  point: SpacePoint;
  metaLine: string;
  readable?: boolean;
  pinned?: boolean;
  style?: React.CSSProperties;
  onOpen?: () => void;
  onAsk?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
};

export default function SourceHoverCard({
  point,
  metaLine,
  readable,
  pinned,
  style,
  onOpen,
  onAsk,
  onContextMenu,
}: Props) {
  return (
    <div
      className={`source-hover-card${pinned ? " pinned" : ""}`}
      style={style}
      onContextMenu={onContextMenu}
    >
      <div className="source-hover-card-head">
        <div className={`source-dot ${point.modality}`}>
          {point.modality.slice(0, 2).toUpperCase()}
        </div>
        <div className="source-hover-card-meta">
          <strong>{point.title}</strong>
          <span>{metaLine}</span>
        </div>
        {onContextMenu && (
          <button
            type="button"
            className="icon-btn source-hover-more"
            title="更多操作"
            onClick={onContextMenu}
          >
            <MoreHorizontal size={15} />
          </button>
        )}
      </div>
      {point.preview && <p className="source-hover-preview">{point.preview}</p>}
      <div className="source-hover-actions">
        {readable && onOpen && (
          <button type="button" className="btn-primary btn-sm" onClick={onOpen}>
            <BookOpen size={14} /> 打开阅读
          </button>
        )}
        {onAsk && (
          <button type="button" className="btn-ghost btn-sm" onClick={onAsk}>
            <MessageSquare size={14} /> 问 Meridian
          </button>
        )}
      </div>
    </div>
  );
}
