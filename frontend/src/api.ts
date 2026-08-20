export const API = import.meta.env.VITE_API_URL;

export type Conversation = {
  id: number;
  title: string;
  created_at: string;
};

export type SourceMeta = {
  id: string;
  title: string;
  modality: string;
  summary?: string;
  created_at?: string;
};

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export function formatApiDetail(detail: unknown, fallback: string) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }
        return String(item);
      })
      .join("；");
  }
  return fallback;
}

export async function apiFetch<T = unknown>(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(
      formatApiDetail((data as { detail?: unknown }).detail, `请求失败（${res.status}）`),
    );
    (error as Error & { status?: number }).status = res.status;
    throw error;
  }
  return data as T;
}

export async function listConversations(token: string): Promise<Conversation[]> {
  return apiFetch<Conversation[]>("/conversations", token);
}

export async function listMessages(token: string, convId: number): Promise<ChatMessage[]> {
  return apiFetch<ChatMessage[]>(`/conversations/${convId}/messages`, token);
}

export async function deleteConversation(token: string, convId: number): Promise<void> {
  await apiFetch(`/conversations/${convId}`, token, { method: "DELETE" });
}

export async function deleteSource(token: string, sourceId: string): Promise<void> {
  await apiFetch(`/sources/${sourceId}`, token, { method: "DELETE" });
}

export async function renameSource(
  token: string,
  sourceId: string,
  title: string,
): Promise<{ source: SourceMeta; space?: unknown }> {
  return apiFetch(`/sources/${sourceId}/title`, token, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function getSource(token: string, sourceId: string): Promise<SourceMeta> {
  const data = await apiFetch<{ source: SourceMeta }>(`/sources/${sourceId}`, token);
  return data.source;
}

export async function fetchSourceFile(token: string, sourceId: string): Promise<Blob> {
  const res = await fetch(`${API}/sources/${sourceId}/file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const error = new Error(
      formatApiDetail((data as { detail?: unknown }).detail, `无法读取文件（${res.status}）`),
    );
    (error as Error & { status?: number }).status = res.status;
    throw error;
  }
  return res.blob();
}

export const READABLE_MODALITIES = new Set(["pdf", "md", "txt"]);

export type StreamPayload =
  | { kind: "conv_id"; convId: number }
  | { kind: "text"; text: string }
  | { kind: "done" };

export function parseStreamPayload(raw: string): StreamPayload | null {
  const payload = raw.trim();
  if (!payload) return null;
  if (payload === "[DONE]") return { kind: "done" };
  if (payload.startsWith("{")) {
    try {
      const meta = JSON.parse(payload) as { conv_id?: number };
      if (typeof meta.conv_id === "number") {
        return { kind: "conv_id", convId: meta.conv_id };
      }
    } catch {
      return { kind: "text", text: payload };
    }
  }
  return { kind: "text", text: payload };
}

export async function streamChat(
  token: string,
  body: { message: string; conv_id?: number | null },
  onPayload: (payload: StreamPayload) => void,
): Promise<void> {
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });
  const res = await fetch(`${API}/chat/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const error = new Error(
      formatApiDetail((data as { detail?: unknown }).detail, `请求失败（${res.status}）`),
    );
    (error as Error & { status?: number }).status = res.status;
    throw error;
  }
  if (!res.body) throw new Error("浏览器不支持流式响应。");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk
        .split("\n")
        .map((row) => row.trim())
        .find((row) => row.startsWith("data:"));
      if (!line) continue;
      const rawPayload = line.slice(5).trimStart();
      const parsed = parseStreamPayload(rawPayload);
      if (parsed) onPayload(parsed);
    }
  }
}
