import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  busy?: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
};

const MAX_NAME_LEN = 20;

export default function CreateShelfDialog({ open, busy, onConfirm, onCancel }: Props) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  if (!open) return null;

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_NAME_LEN && !busy;

  function submit() {
    if (!canSubmit) return;
    onConfirm(trimmed);
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
        aria-labelledby="create-shelf-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="create-shelf-title">新建资料架</h3>
        <p className="rename-hint">给架子起一个简短名字，方便之后归类资料。</p>
        <input
          className="rename-input"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LEN))}
          placeholder="例如：考研备考"
          disabled={busy}
          autoFocus
          maxLength={MAX_NAME_LEN}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape" && !busy) onCancel();
          }}
        />
        <p className="rename-hint rename-hint--count">
          {trimmed.length}/{MAX_NAME_LEN}
        </p>
        <div className="confirm-actions">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn-primary" disabled={!canSubmit} onClick={submit}>
            {busy ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
