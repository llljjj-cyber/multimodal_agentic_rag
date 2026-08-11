import { ChevronDown, Loader2, Send } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../api";
import { cleanAnswerText, splitThinkingContent } from "../messageFormat";

type Props = {
  messages: ChatMessage[];
  draft: string;
  streamingText: string;
  isSending: boolean;
  error: string;
  convId: number | null;
  onDraftChange: (value: string) => void;
  onSend: () => void;
};

function AnswerBlocks({ content }: { content: string }) {
  const cleaned = cleanAnswerText(content);
  if (!cleaned) {
    return <p className="message-placeholder">…</p>;
  }

  const blocks = cleaned.split(/\n\s*\n/).filter(Boolean);
  return (
    <div className="answer-content">
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        const isList = lines.length > 1 && lines.every((line) => line.startsWith("- "));
        if (isList) {
          return (
            <ul key={blockIndex}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{line.replace(/^- /, "")}</li>
              ))}
            </ul>
          );
        }
        return lines.map((line, lineIndex) => {
          if (line.startsWith("- ")) {
            return (
              <ul key={`${blockIndex}-${lineIndex}`}>
                <li>{line.replace(/^- /, "")}</li>
              </ul>
            );
          }
          return <p key={`${blockIndex}-${lineIndex}`}>{line}</p>;
        });
      })}
    </div>
  );
}

function ThinkingBlock({
  thinking,
  openByDefault = false,
  streaming = false,
}: {
  thinking: string;
  openByDefault?: boolean;
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(openByDefault || streaming);

  useEffect(() => {
    if (streaming) setOpen(true);
  }, [streaming]);

  if (!thinking.trim() && !streaming) return null;

  return (
    <div className={`thinking-block ${streaming ? "streaming" : ""}`}>
      <button
        type="button"
        className="thinking-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <ChevronDown size={14} className={open ? "open" : ""} />
        <span>{streaming ? "正在思考" : "思维过程"}</span>
        {streaming && <Loader2 className="spin" size={12} />}
      </button>
      {open && (
        <div className="thinking-body">
          {thinking.trim() ? (
            <pre>{thinking}</pre>
          ) : (
            <p className="message-placeholder">模型正在推理…</p>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBody({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const { thinking, answer, thinkingOpen } = splitThinkingContent(content);
  const showThinking = Boolean(thinking) || (streaming && thinkingOpen);
  const showAnswer = Boolean(answer);
  const onlyThinking = streaming && thinkingOpen && !answer;

  return (
    <div className="message-body">
      {showThinking && (
        <ThinkingBlock
          thinking={thinking}
          openByDefault={streaming && thinkingOpen}
          streaming={onlyThinking || (streaming && thinkingOpen)}
        />
      )}
      {showAnswer ? (
        <AnswerBlocks content={answer} />
      ) : streaming && !showThinking ? (
        <p className="message-placeholder">
          <Loader2 className="spin" size={14} /> 正在生成…
        </p>
      ) : null}
    </div>
  );
}

export default function ChatPanel({
  messages,
  draft,
  streamingText,
  isSending,
  error,
  convId,
  onDraftChange,
  onSend,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, streamingText, isSending]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || isSending) return;
    onSend();
  }

  return (
    <section className="chat-panel panel">
      <div className="panel-heading chat-panel-heading">
        <div>
          <h2>聊天</h2>
          <p>{convId != null ? `当前会话 #${convId}` : "新会话 · 首条消息将创建 conv_id"}</p>
        </div>
      </div>

      <div className="chat-thread" ref={scrollRef} aria-live="polite">
        {messages.length === 0 && !streamingText && !isSending && (
          <div className="empty-state chat-empty">
            向资料助手提问。回答会通过 /chat/stream 流式返回。
          </div>
        )}

        {messages.map((message) => (
          <article
            key={message.id}
            className={`chat-bubble ${message.role === "user" ? "user" : "assistant"}`}
          >
            <header>{message.role === "user" ? "你" : "助手"}</header>
            {message.role === "assistant" ? (
              <MessageBody content={message.content} />
            ) : (
              <AnswerBlocks content={message.content} />
            )}
          </article>
        ))}

        {(isSending || streamingText) && (
          <article className="chat-bubble assistant streaming">
            <header>助手</header>
            {streamingText ? (
              <MessageBody content={streamingText} streaming />
            ) : (
              <p className="message-placeholder">
                <Loader2 className="spin" size={14} /> 正在思考…
              </p>
            )}
          </article>
        )}
      </div>

      {error && (
        <div className="inline-status error chat-error" role="alert">
          {error}
        </div>
      )}

      <form className="chat-composer" onSubmit={handleSubmit}>
        <textarea
          className="question-box chat-input"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="输入问题…"
          rows={3}
          disabled={isSending}
          aria-label="聊天输入"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!draft.trim() || isSending) return;
              onSend();
            }
          }}
        />
        <button className="primary-button chat-send" type="submit" disabled={isSending || !draft.trim()}>
          {isSending ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
          发送
        </button>
      </form>
    </section>
  );
}
