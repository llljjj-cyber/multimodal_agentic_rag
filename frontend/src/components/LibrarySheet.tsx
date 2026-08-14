import { Loader2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { apiFetch, READABLE_MODALITIES, type SourceMeta } from "../api";

type Props = {
  open: boolean;
  token: string;
  onClose: () => void;
  onUpdated: () => void;
  onOpenReader?: (source: SourceMeta) => void;
};

export default function LibrarySheet({ open, token, onClose, onUpdated, onOpenReader }: Props) {
  const [tab, setTab] = useState<"text" | "url" | "file">("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  async function submit() {
    setBusy(true);
    setError("");
    setStatus("入库中…");
    try {
      let uploaded: SourceMeta | null = null;
      if (tab === "text") {
        await apiFetch("/sources/text", token, {
          method: "POST",
          body: JSON.stringify({ title: title || "未命名", text, modality: "text" }),
        });
      } else if (tab === "url") {
        await apiFetch("/sources/url", token, {
          method: "POST",
          body: JSON.stringify({ url, title: title || undefined }),
        });
      } else {
        const file = fileRef.current?.files?.[0];
        if (!file) { setError("请选择文件"); setBusy(false); return; }
        const form = new FormData();
        form.append("title", title || file.name);
        form.append("file", file);
        const data = await apiFetch<{ source: SourceMeta }>("/sources/file", token, { method: "POST", body: form });
        uploaded = data.source;
      }
      setStatus(uploaded && READABLE_MODALITIES.has(uploaded.modality) ? "已入库，正在打开阅读…" : "已入库，资料空间将刷新。");
      onUpdated();
      if (uploaded && READABLE_MODALITIES.has(uploaded.modality)) {
        onOpenReader?.(uploaded);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "入库失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="library-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="添加入库">
        <header className="sheet-header">
          <div>
            <h3>添加入库</h3>
            <p>支持 PDF · Markdown · 文本</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </header>
        <div className="add-tabs">
          {(["text", "url", "file"] as const).map((t) => (
            <button key={t} type="button" className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "text" ? "文本" : t === "url" ? "链接" : "文件"}
            </button>
          ))}
        </div>
        <label className="field-label">标题</label>
        <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="可选" />
        {tab === "text" && (
          <>
            <label className="field-label">正文</label>
            <textarea className="field-input field-textarea" value={text} onChange={(e) => setText(e.target.value)} />
          </>
        )}
        {tab === "url" && (
          <>
            <label className="field-label">网址</label>
            <input className="field-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </>
        )}
        {tab === "file" && (
          <>
            <label className="field-label">文件</label>
            <input ref={fileRef} type="file" accept=".txt,.md,.pdf" className="field-input" />
          </>
        )}
        <button type="button" className="btn-primary sheet-submit" onClick={submit} disabled={busy}>
          {busy ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
          嵌入入库
        </button>
        {status && <div className="status-banner ok">{status}</div>}
        {error && <div className="status-banner err">{error}</div>}
      </div>
    </div>
  );
}
