import { Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { IngestInput, Shelf } from "../api";

type Props = {
  open: boolean;
  shelves: Shelf[];
  defaultShelfId?: string | null;
  onClose: () => void;
  onSubmit: (input: IngestInput) => void;
};

export default function LibrarySheet({
  open,
  shelves,
  defaultShelfId = null,
  onClose,
  onSubmit,
}: Props) {
  const [tab, setTab] = useState<"text" | "url" | "file">("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [shelfId, setShelfId] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setShelfId(defaultShelfId ?? "");
      setError("");
    }
  }, [open, defaultShelfId]);

  if (!open) return null;

  function resetForm() {
    setTitle("");
    setText("");
    setUrl("");
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleSubmit() {
    setError("");
    const shelfPayload = shelfId ? shelfId : null;

    if (tab === "text") {
      if (!text.trim()) {
        setError("请输入正文");
        return;
      }
      onSubmit({
        kind: "text",
        title: title || "未命名",
        text,
        shelf_id: shelfPayload,
      });
    } else if (tab === "url") {
      if (!url.trim()) {
        setError("请输入网址");
        return;
      }
      onSubmit({
        kind: "url",
        url: url.trim(),
        title: title || undefined,
        shelf_id: shelfPayload,
      });
    } else {
      const file = fileRef.current?.files?.[0];
      if (!file) {
        setError("请选择文件");
        return;
      }
      onSubmit({
        kind: "file",
        file,
        title: title || file.name,
        shelf_id: shelfPayload,
      });
    }

    resetForm();
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="library-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="添加入库">
        <header className="sheet-header">
          <div>
            <h3>添加入库</h3>
            <p>支持 PDF · Markdown · 文本</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="add-tabs">
          {(["text", "url", "file"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t === "text" ? "文本" : t === "url" ? "链接" : "文件"}
            </button>
          ))}
        </div>
        <label className="field-label">标题</label>
        <input
          className="field-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="可选"
        />
        <label className="field-label">放进资料架</label>
        <select className="field-input" value={shelfId} onChange={(e) => setShelfId(e.target.value)}>
          <option value="">未分类（稍后整理）</option>
          {shelves.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {defaultShelfId && shelves.some((s) => s.id === defaultShelfId) && (
          <p className="field-hint">已根据当前资料架预选，可随时更改。</p>
        )}
        {tab === "text" && (
          <>
            <label className="field-label">正文</label>
            <textarea
              className="field-input field-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </>
        )}
        {tab === "url" && (
          <>
            <label className="field-label">网址</label>
            <input
              className="field-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </>
        )}
        {tab === "file" && (
          <>
            <label className="field-label">文件</label>
            <input ref={fileRef} type="file" accept=".txt,.md,.pdf" className="field-input" />
          </>
        )}

        <button type="button" className="btn-primary sheet-submit" onClick={handleSubmit}>
          <Upload size={16} />
          嵌入入库
        </button>

        {error && <div className="status-banner err">{error}</div>}
      </div>
    </div>
  );
}
