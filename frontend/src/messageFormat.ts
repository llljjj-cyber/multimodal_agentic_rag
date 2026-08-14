export type SplitAnswer = {
  thinking: string;
  answer: string;
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

export function cleanAnswerText(value: string, opts?: { keepBold?: boolean }) {
  let text = value
    .replace(/\[[a-f0-9]{8,12}-\d+\]/gi, "")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!opts?.keepBold) {
    text = text.replace(/\*\*/g, "");
  }
  return text;
}

export function parseMarkdownTableBlock(lines: string[]): { headers: string[]; rows: string[][] } | null {
  const trimmed = lines.map((line) => line.trim()).filter(Boolean);
  if (trimmed.length < 2 || !trimmed.every((line) => line.includes("|"))) {
    return null;
  }

  const parseRow = (line: string) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  const dataLines = trimmed.filter((line) => !/^\|[\s\-:|]+\|$/.test(line));
  if (dataLines.length < 1) return null;

  return {
    headers: parseRow(dataLines[0]),
    rows: dataLines.slice(1).map(parseRow),
  };
}
