import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  currentTitle: string;
  busy?: boolean;
  disabled?: boolean;
  disabledHint?: string;
  onConfirm: (title: string) => void;
  onCancel: () => void;
};

export default function RenameSourceDialog({
  open,
  currentTitle,
  busy,
  disabled,
  disabledHint,
  onConfirm,
  onCancel,
}: Props) {
  const [title, setTitle] = useState(currentTitle);

  useEffect(() => {
    if (open) setTitle(currentTitle);
  }, [open, currentTitle]);

  if (!open) return null;

  return (
    <div
      className="confirm-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="confirm-dialog rename-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>修改资料标题</h3>
        {disabledHint && <p className="rename-hint">{disabledHint}</p>}
        <input
          className="rename-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="输入新标题"
          disabled={busy || disabled}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim() && !disabled) onConfirm(title.trim());
          }}
        />
        <div className="confirm-actions">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || disabled || !title.trim()}
            onClick={() => onConfirm(title.trim())}
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
