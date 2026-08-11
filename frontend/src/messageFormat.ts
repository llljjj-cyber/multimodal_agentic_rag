/**
 * DeepSeek / 推理模型常见会把思维链和正式回复混在同一段文本里。
 * 支持：
 * - <think>...</think>
 * - <thinking>...</thinking>
 * - 流式未闭合的开标签
 */

export type SplitAnswer = {
  thinking: string;
  answer: string;
  /** 思维链标签已开始但尚未闭合（流式中） */
  thinkingOpen: boolean;
};

const THINK_BLOCK =
  /<(think|thinking|reasoning|redacted_reasoning)\b[^>]*>([\s\S]*?)<\/\1>/gi;

const THINK_OPEN =
  /<(think|thinking|reasoning|redacted_reasoning)\b[^>]*>([\s\S]*)$/i;

export function splitThinkingContent(raw: string): SplitAnswer {
  const source = raw ?? "";
  if (!source.trim()) {
    return { thinking: "", answer: "", thinkingOpen: false };
  }

  const thinkingParts: string[] = [];
  let remainder = source.replace(THINK_BLOCK, (_match, _tag, inner: string) => {
    const trimmed = String(inner ?? "").trim();
    if (trimmed) thinkingParts.push(trimmed);
    return "";
  });

  let thinkingOpen = false;
  const openMatch = remainder.match(THINK_OPEN);
  if (openMatch) {
    thinkingOpen = true;
    const openInner = String(openMatch[2] ?? "").trim();
    if (openInner) thinkingParts.push(openInner);
    remainder = remainder.slice(0, openMatch.index).trimEnd();
  }

  return {
    thinking: thinkingParts.join("\n\n").trim(),
    answer: remainder.trim(),
    thinkingOpen,
  };
}

export function cleanAnswerText(value: string) {
  return value
    .replace(/\[[a-f0-9]{8,12}-\d+\]/gi, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
