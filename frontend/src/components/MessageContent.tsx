import { ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cleanAnswerText, parseMarkdownTableBlock, splitThinkingContent } from "../messageFormat";

function renderInline(text: string) {
  // Keep simple bold markers that cleanAnswerText leaves intact.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={i}>{bold[1]}</strong>;
    return part;
  });
}

function renderLine(line: string, key: string) {
  const heading = line.match(/^(#{1,4})\s+(.+)$/);
  if (heading) {
    const level = heading[1].length;
    const text = heading[2];
    if (level === 1) return <h3 key={key} className="butler-h1">{renderInline(text)}</h3>;
    if (level === 2) return <h4 key={key} className="butler-h2">{renderInline(text)}</h4>;
    return <h5 key={key} className="butler-h3">{renderInline(text)}</h5>;
  }
  if (line.startsWith("- ")) {
    return <ul key={key}><li>{renderInline(line.replace(/^- /, ""))}</li></ul>;
  }
  return <p key={key}>{renderInline(line)}</p>;
}

function AnswerBlocks({ content }: { content: string }) {
  // Preserve **bold** for inline render; still normalize list bullets.
  const cleaned = cleanAnswerText(content, { keepBold: true });
  if (!cleaned) return <p className="butler-placeholder">…</p>;

  const blocks = cleaned.split(/\n\s*\n/).filter(Boolean);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
        const table = parseMarkdownTableBlock(lines);
        if (table) {
          return (
            <div key={i} className="butler-table-wrap">
              <table className="butler-table">
                <thead><tr>{table.headers.map((h, j) => <th key={j}>{renderInline(h)}</th>)}</tr></thead>
                <tbody>{table.rows.map((row, ri) => <tr key={ri}>{row.map((c, ci) => <td key={ci}>{renderInline(c)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        if (lines.length > 1 && lines.every((l) => l.startsWith("- "))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{renderInline(l.replace(/^- /, ""))}</li>)}</ul>;
        }
        return lines.map((line, j) => renderLine(line, `${i}-${j}`));
      })}
    </>
  );
}

function ThinkingBlock({ thinking, streaming }: { thinking: string; streaming?: boolean }) {
  const [open, setOpen] = useState(streaming ?? false);
  useEffect(() => { if (streaming) setOpen(true); }, [streaming]);
  if (!thinking.trim() && !streaming) return null;

  return (
    <div className="butler-think">
      <button type="button" className="butler-think-toggle" onClick={() => setOpen((v) => !v)}>
        <ChevronDown size={14} className={open ? "open" : ""} />
        <span>{streaming ? "Meridian 正在整理思路" : "整理思路"}</span>
        {streaming && <Loader2 className="spin" size={12} />}
      </button>
      {open && (
        <div className="butler-think-body">
          {thinking.trim() ? <pre>{thinking}</pre> : <p className="butler-placeholder">…</p>}
        </div>
      )}
    </div>
  );
}

export default function MessageContent({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const { thinking, answer, thinkingOpen } = splitThinkingContent(content);
  const showThinking = Boolean(thinking) || (streaming && thinkingOpen);

  return (
    <>
      {showThinking && <ThinkingBlock thinking={thinking} streaming={streaming && thinkingOpen} />}
      {answer ? (
        <AnswerBlocks content={answer} />
      ) : streaming && !showThinking ? (
        <p className="butler-placeholder"><Loader2 className="spin" size={14} /> Meridian 正在准备回复…</p>
      ) : null}
    </>
  );
}
