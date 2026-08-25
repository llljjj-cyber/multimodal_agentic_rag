import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  currentTitle: string;
  heading?: string;
  placeholder?: string;
  maxLength?: number;
  busy?: boolean;
  disabled?: boolean;
  disabledHint?: string;
  onConfirm: (title: string) => void;
  onCancel: () => void;
};

export default function RenameSourceDialog({
  open,
  currentTitle,
  heading = "修改资料标题",
  placeholder = "输入新标题",
  maxLength,
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

  function handleChange(value: string) {
    setTitle(maxLength != null ? value.slice(0, maxLength) : value);
  }

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
        <h3>{heading}</h3>
        {disabledHint && <p className="rename-hint">{disabledHint}</p>}
        <input
          className="rename-input"
          value={title}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          disabled={busy || disabled}
          autoFocus
          maxLength={maxLength}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim() && !disabled) onConfirm(title.trim());
          }}
        />
        {maxLength != null && (
          <p className="rename-hint rename-hint--count">
            {title.trim().length}/{maxLength}
          </p>
        )}
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
