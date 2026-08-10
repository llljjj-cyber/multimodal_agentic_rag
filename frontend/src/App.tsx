import {
  Activity,
  AudioLines,
  Bot,
  Box,
  BrainCircuit,
  FileText,
  FolderOpen,
  Image,
  Link,
  Loader2,
  LogOut,
  MessageSquare,
  Plus,
  RadioTower,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import {
  apiFetch,
  deleteConversation,
  listConversations,
  listMessages,
  streamChat,
  type ChatMessage,
  type Conversation,
} from "./api";
import ChatPanel from "./components/ChatPanel";
import ConversationSidebar from "./components/ConversationSidebar";

const TOKEN_KEY = "mar_access_token";
const USER_KEY = "mar_username";

type Modality = "text" | "url" | "pdf" | "image" | "audio" | "video" | "query";

type RackPoint = {
  id: string;
  source_id: string;
  title: string;
  modality: Modality;
  projection: { x: number; y: number; z: number };
  color: string;
  preview?: string;
  score?: number;
};

type RackSource = {
  id: string;
  title: string;
  modality: Modality;
  summary: string;
  chunks: number;
  created_at: number;
  file_path?: string | null;
  metadata?: Record<string, unknown>;
};

type SpaceSnapshot = {
  sources: RackSource[];
  points: RackPoint[];
  events: Array<Record<string, unknown>>;
  provider: string;
  dimensions: number;
  model: string;
  projection?: { method: string; basis: string };
};

type Match = {
  id: string;
  source_id: string;
  title: string;
  modality: Modality;
  text: string;
  score: number;
  projection?: { x: number; y: number; z: number };
};

type AskResponse = {
  answer: string;
  matches: Match[];
  query_point: RackPoint;
  trace: Array<{ agent: string; status: string; detail: string }>;
  space: SpaceSnapshot;
};

function normalizeSource(raw: Record<string, unknown>): RackSource {
  const meta = (raw.metadata ?? raw.metadata_ ?? {}) as Record<string, unknown>;
  const created = raw.created_at;
  let createdAt = Date.now();
  if (typeof created === "string") createdAt = Date.parse(created) || Date.now();
  else if (typeof created === "number") createdAt = created;

  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    modality: (raw.modality as Modality) || "text",
    summary: String(raw.summary ?? ""),
    chunks:
      typeof raw.chunks === "number"
        ? raw.chunks
        : typeof raw.chunk_count === "number"
          ? raw.chunk_count
          : 0,
    created_at: createdAt,
    file_path: raw.file_path == null ? null : String(raw.file_path),
    metadata: meta,
  };
}

function normalizeSpace(data: unknown): SpaceSnapshot {
  const payload = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const sourcesRaw = Array.isArray(payload.sources) ? payload.sources : [];
  return {
    sources: sourcesRaw.map((item) => normalizeSource((item ?? {}) as Record<string, unknown>)),
    points: (Array.isArray(payload.points) ? payload.points : []) as RackPoint[],
    events: (Array.isArray(payload.events) ? payload.events : []) as Array<Record<string, unknown>>,
    provider: String(payload.provider ?? "未知"),
    dimensions: typeof payload.dimensions === "number" ? payload.dimensions : 768,
    model: String(payload.model ?? ""),
    projection: payload.projection as SpaceSnapshot["projection"],
  };
}

const modalityIcon: Record<Modality, React.ElementType> = {
  text: FileText,
  url: Link,
  pdf: FileText,
  image: Image,
  audio: AudioLines,
  video: Video,
  query: Search,
};

const sampleText = `Gemini Embedding 2 可以把文本、图片、音频、视频和 PDF 映射到同一语义向量空间。在 Agentic RAG 中，智能体先用「检索文档」任务前缀嵌入资料分块，再用「问答查询」任务前缀嵌入用户问题，检索最近邻证据，并综合生成带引用的回答。适当截断向量维度可以降低存储成本，同时保留有用的语义邻域。`;

const DEFAULT_TITLE = "Gemini Embedding 2 学习笔记";

const modalityLabels: Array<{ key: string; label: string }> = [
  { key: "text", label: "文本" },
  { key: "image", label: "图片" },
  { key: "audio", label: "音频" },
  { key: "video", label: "视频" },
  { key: "pdf", label: "PDF" },
  { key: "query", label: "查询" },
];

const modalityName: Record<string, string> = {
  text: "文本",
  url: "网页",
  pdf: "PDF",
  image: "图片",
  audio: "音频",
  video: "视频",
  query: "查询",
};

function scorePct(score: number) {
  return `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function indexFromId(id: string) {
  return Array.from(id).reduce((total, char) => total + char.charCodeAt(0), 0);
}

function cleanAnswerText(value: string) {
  return value
    .replace(/\[[a-f0-9]{8,12}-\d+\]/gi, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function AnswerContent({ answer }: { answer: string }) {
  const cleaned = cleanAnswerText(answer);

  if (!cleaned) {
    return <p>ADK 协调器从资料中检索证据后，回答会显示在这里。</p>;
  }

  const blocks = cleaned.split(/\n\s*\n/).filter(Boolean);
  return (
    <div className="answer-content">
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        const isList = lines.length > 1 && lines.every((line) => line.startsWith("- "));
        const hasHeadingAndList =
          lines.length > 2 &&
          (lines[0].endsWith(":") || lines[0].endsWith("：")) &&
          lines.slice(1).every((line) => line.startsWith("- "));
        if (isList) {
          return (
            <ul key={blockIndex}>
              {lines.map((line, lineIndex) => <li key={lineIndex}>{line.replace(/^- /, "")}</li>)}
            </ul>
          );
        }
        if (hasHeadingAndList) {
          return (
            <div className="answer-section" key={blockIndex}>
              <h3>{lines[0].replace(/[:：]$/, "")}</h3>
              <ul>
                {lines.slice(1).map((line, lineIndex) => <li key={lineIndex}>{line.replace(/^- /, "")}</li>)}
              </ul>
            </div>
          );
        }
        return lines.map((line, lineIndex) => {
          if ((line.endsWith(":") || line.endsWith("：")) && line.length < 48) {
            return <h3 key={`${blockIndex}-${lineIndex}`}>{line.replace(/[:：]$/, "")}</h3>;
          }
          if (line.startsWith("- ")) {
            return <ul key={`${blockIndex}-${lineIndex}`}><li>{line.replace(/^- /, "")}</li></ul>;
          }
          return <p key={`${blockIndex}-${lineIndex}`}>{line}</p>;
        });
      })}
    </div>
  );
}

function makeGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.Texture();

  const gradient = context.createRadialGradient(64, 64, 3, 64, 64, 62);
  gradient.addColorStop(0, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.22, "rgba(255,255,255,0.48)");
  gradient.addColorStop(0.58, "rgba(255,255,255,0.14)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function VectorSpace({
  points,
  queryPoint,
  matches,
  selectedId,
  onSelect,
}: {
  points: RackPoint[];
  queryPoint: RackPoint | null;
  matches: Match[];
  selectedId: string | null;
  onSelect: (point: RackPoint | null) => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const pointMapRef = useRef<Map<string, RackPoint>>(new Map());
  const selectedIdRef = useRef<string | null>(selectedId);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!mountRef.current) return;

    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x070806, 9, 26);

    const camera = new THREE.PerspectiveCamera(48, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(0, 1.9, 9.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const frameGroup = new THREE.Group();
    const pointGroup = new THREE.Group();
    scene.add(frameGroup);
    scene.add(pointGroup);

    const grid = new THREE.GridHelper(10, 20, 0xf54e00, 0x303126);
    grid.position.y = -2.8;
    grid.material.opacity = 0.28;
    grid.material.transparent = true;
    frameGroup.add(grid);

    const axes = [
      [new THREE.Vector3(-4.8, -2.6, -2.8), new THREE.Vector3(4.8, -2.6, -2.8), 0xf54e00],
      [new THREE.Vector3(-4.8, -2.6, -2.8), new THREE.Vector3(-4.8, 2.8, -2.8), 0x9fc9a2],
      [new THREE.Vector3(-4.8, -2.6, -2.8), new THREE.Vector3(-4.8, -2.6, 2.8), 0x9fbbe0],
    ] as const;
    axes.forEach(([start, end, color]) => {
      const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
      const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
      frameGroup.add(new THREE.Line(geometry, material));
    });

    const backdropGeometry = new THREE.BufferGeometry();
    const backdropPositions = new Float32Array(150 * 3);
    for (let index = 0; index < 150; index += 1) {
      backdropPositions[index * 3] = (Math.random() - 0.5) * 12;
      backdropPositions[index * 3 + 1] = (Math.random() - 0.5) * 7;
      backdropPositions[index * 3 + 2] = (Math.random() - 0.5) * 9;
    }
    backdropGeometry.setAttribute("position", new THREE.BufferAttribute(backdropPositions, 3));
    const backdrop = new THREE.Points(
      backdropGeometry,
      new THREE.PointsMaterial({ color: 0xf7f7f4, size: 0.012, transparent: true, opacity: 0.34 })
    );
    frameGroup.add(backdrop);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pointerTarget = new THREE.Vector2();
    const meshes: THREE.Mesh[] = [];
    const halos: THREE.Sprite[] = [];
    const objectsById = new Map<string, { halo?: THREE.Sprite; base: THREE.Vector3; orbit: number; phase: number; speed: number }>();
    const matchedIds = new Set(matches.map((match) => match.source_id));
    const glowTexture = makeGlowTexture();
    const allPoints = queryPoint ? [...points, queryPoint] : points;
    pointMapRef.current = new Map(allPoints.map((point) => [point.id, point]));

    allPoints.forEach((point) => {
      const position = new THREE.Vector3(point.projection.x * 1.35, point.projection.y * 1.35, point.projection.z * 1.35);
      const isQuery = point.modality === "query";
      const isMatched = matchedIds.has(point.source_id);
      if (isQuery || isMatched) {
        const haloMaterial = new THREE.SpriteMaterial({
          map: glowTexture,
          color: new THREE.Color(isQuery ? "#f54e00" : point.color),
          transparent: true,
          opacity: isQuery ? 0.32 : 0.24,
          depthWrite: false,
        });
        const halo = new THREE.Sprite(haloMaterial);
        halo.position.copy(position);
        halo.scale.setScalar(isQuery ? 0.72 : 0.58);
        halo.userData.baseScale = isQuery ? 0.72 : 0.58;
        halo.userData.baseOpacity = isQuery ? 0.32 : 0.24;
        halo.userData.id = point.id;
        halos.push(halo);
        pointGroup.add(halo);
      }

      const geometry = new THREE.SphereGeometry(0.08, 24, 24);
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(point.color),
        transparent: true,
        opacity: point.modality === "query" ? 1 : 0.9,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      mesh.userData.id = point.id;
      meshes.push(mesh);
      pointGroup.add(mesh);
      objectsById.set(point.id, {
        halo: halos.find((item) => item.userData.id === point.id),
        base: position,
        orbit: isQuery ? 0.028 : 0.075 + (indexFromId(point.id) % 5) * 0.012,
        phase: (indexFromId(point.id) % 13) * 0.62,
        speed: isQuery ? 0.28 : 0.34 + (indexFromId(point.id) % 7) * 0.035,
      });
    });

    const handlePointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      pointerTarget.set(pointer.x, pointer.y);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes)[0];
      renderer.domElement.style.cursor = hit ? "pointer" : "default";
      onSelect(hit ? pointMapRef.current.get(hit.object.userData.id) ?? null : null);
    };

    const handlePointerLeave = () => {
      pointerTarget.set(0, 0);
      renderer.domElement.style.cursor = "default";
      onSelect(null);
    };

    renderer.domElement.addEventListener("pointermove", handlePointer);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);

    const resize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", resize);

    let frame = 0;
    let animation = 0;
    const animate = () => {
      frame += 0.01;
      camera.position.x += (pointerTarget.x * 0.18 - camera.position.x) * 0.025;
      camera.position.y += (1.9 + pointerTarget.y * 0.1 - camera.position.y) * 0.025;
      camera.lookAt(0, 0, 0);
      meshes.forEach((mesh, index) => {
        const object = objectsById.get(mesh.userData.id);
        if (object) {
          const theta = frame * object.speed + object.phase;
          const bob = Math.sin(frame * object.speed * 1.7 + object.phase) * object.orbit * 0.48;
          mesh.position.set(
            object.base.x + Math.cos(theta) * object.orbit,
            object.base.y + bob,
            object.base.z + Math.sin(theta) * object.orbit
          );
          mesh.rotation.y += 0.012 + index * 0.0004;
          mesh.rotation.x += 0.006;
          object.halo?.position.copy(mesh.position);
        }
        const pulse = 1 + Math.sin(frame * 2.2 + index) * 0.055;
        mesh.scale.setScalar(mesh.userData.id === selectedIdRef.current ? 1.22 : pulse);
      });
      halos.forEach((halo, index) => {
        const base = halo.userData.baseScale || 0.58;
        const pulse = 1 + Math.sin(frame * 1.7 + index) * 0.08;
        halo.scale.setScalar(base * pulse);
        const material = halo.material as THREE.SpriteMaterial;
        material.opacity = halo.userData.id === selectedIdRef.current ? 0.46 : halo.userData.baseOpacity;
      });
      renderer.render(scene, camera);
      animation = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animation);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointermove", handlePointer);
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
      mount.removeChild(renderer.domElement);
      glowTexture.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material.dispose();
        }
        if (object instanceof THREE.Sprite) {
          object.material.dispose();
        }
      });
      renderer.dispose();
    };
  }, [points, queryPoint, matches, onSelect]);

  return <div className="vector-canvas" ref={mountRef} />;
}

function SourceRow({
  source,
  isRemoving,
  onRemove,
}: {
  source: RackSource;
  isRemoving: boolean;
  onRemove: (source: RackSource) => void;
}) {
  const Icon = modalityIcon[source.modality] || Box;
  const embeddingPath = String(source.metadata?.embedding_path || "");
  const metaBits = [
    source.chunks > 0 ? `${source.chunks} 个分块` : "",
    embeddingPath ? embeddingPath.replace("gemini-", "Gemini ") : "",
    source.file_path || "",
  ].filter(Boolean);
  return (
    <div className="source-row">
      <div className={`modality-dot ${source.modality}`}>
        <Icon size={15} />
      </div>
      <div className="source-copy">
        <div className="source-title">{source.title}</div>
        <div className="source-summary">{source.summary}</div>
        {metaBits.length > 0 && <div className="source-meta">{metaBits.join(" · ")}</div>}
      </div>
      <div className="source-actions">
        <button className="delete-source" onClick={() => onRemove(source)} disabled={isRemoving} aria-label={`删除 ${source.title}`}>
          {isRemoving ? <Loader2 className="spin" size={13} /> : <Trash2 size={13} />}
        </button>
      </div>
    </div>
  );
}

function AuthScreen({
  onAuth,
}: {
  onAuth: (token: string, username: string) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (mode === "register") {
        await apiFetch("/auth/register", null, {
          method: "POST",
          body: JSON.stringify({ username, password }),
        });
        setStatus("注册成功，正在登录…");
      }
      const tokenPayload = (await apiFetch("/auth/login", null, {
        method: "POST",
        body: JSON.stringify({ username, password }),
      })) as { access_token: string };
      onAuth(tokenPayload.access_token, username);
    } catch (err) {
      setError(err instanceof Error ? err.message : "认证失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell auth-shell">
      <div className="auth-card panel">
        <div className="brand auth-brand">
          <div className="brand-mark">
            <BrainCircuit size={22} />
          </div>
          <div>
            <h1>个人资料助手</h1>
            <p>多模态 Agentic RAG · Gemini Embedding 2 · Google ADK</p>
          </div>
        </div>

        <div className="tabs" role="tablist">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => {
              setMode("login");
              setError("");
              setStatus("");
            }}
          >
            登录
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => {
              setMode("register");
              setError("");
              setStatus("");
            }}
          >
            注册
          </button>
        </div>

        <form onSubmit={submit}>
          <label className="field-label">用户名</label>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            maxLength={12}
            minLength={1}
            required
            autoComplete="username"
            placeholder="1–12 个字符"
            aria-label="用户名"
          />
          <label className="field-label">密码</label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            maxLength={12}
            minLength={6}
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="6–12 个字符"
            aria-label="密码"
          />
          <button className="primary-button auth-submit" type="submit" disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : null}
            {mode === "login" ? "进入工作区" : "创建账户并进入"}
          </button>
        </form>

        {(error || status) && (
          <div className={`inline-status ${error ? "error" : "success"}`} role="status">
            {error || status}
          </div>
        )}
      </div>
    </main>
  );
}

function Workspace({
  token,
  username,
  onLogout,
}: {
  token: string;
  username: string;
  onLogout: () => void;
}) {
  const [workspaceView, setWorkspaceView] = useState<"chat" | "library">("chat");
  const [space, setSpace] = useState<SpaceSnapshot | null>(null);
  const [tab, setTab] = useState<"text" | "url" | "file" | "path">("text");
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [text, setText] = useState(sampleText);
  const [url, setUrl] = useState("https://developers.googleblog.com/building-with-gemini-embedding-2/");
  const [notes, setNotes] = useState("上传到个人资料助手的资料备注。");
  const [filePath, setFilePath] = useState("");
  const [question, setQuestion] = useState("Gemini Embedding 2 如何帮助跨模态的 Agentic RAG？");
  const [answer, setAnswer] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [trace, setTrace] = useState<AskResponse["trace"]>([]);
  const [queryPoint, setQueryPoint] = useState<RackPoint | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<RackPoint | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [deletingConvId, setDeletingConvId] = useState<number | null>(null);
  const [isAddingSource, setIsAddingSource] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [removingSourceId, setRemovingSourceId] = useState<string | null>(null);
  const [sourceStatus, setSourceStatus] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [qaStatus, setQaStatus] = useState("");
  const [qaError, setQaError] = useState("");
  const [chatError, setChatError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const points = useMemo(() => space?.points ?? [], [space]);
  const sourceCount = space?.sources.length ?? 0;
  const pointCount = space?.points.length ?? 0;
  const provider = space?.provider ?? "加载中";
  const projection = space?.projection?.method?.replace("_", " ").toUpperCase() ?? "PCA 3D";

  const handleAuthFailure = useCallback(
    (error: unknown) => {
      if (error && typeof error === "object" && "status" in error && (error as { status?: number }).status === 401) {
        onLogout();
      }
    },
    [onLogout],
  );

  const refreshSpace = useCallback(async () => {
    const data = await apiFetch<{ space?: unknown }>("/space", token);
    setSpace(normalizeSpace(data));
  }, [token]);

  const refreshConversations = useCallback(async () => {
    setConversationsLoading(true);
    try {
      const rows = await listConversations(token);
      setConversations(rows);
    } catch (error) {
      handleAuthFailure(error);
      setChatError(error instanceof Error ? error.message : "加载会话失败。");
    } finally {
      setConversationsLoading(false);
    }
  }, [token, handleAuthFailure]);

  const loadMessages = useCallback(
    async (convId: number) => {
      setMessagesLoading(true);
      setChatError("");
      try {
        const rows = await listMessages(token, convId);
        setMessages(rows);
      } catch (error) {
        handleAuthFailure(error);
        setChatError(error instanceof Error ? error.message : "加载消息失败。");
        setMessages([]);
      } finally {
        setMessagesLoading(false);
      }
    },
    [token, handleAuthFailure],
  );

  useEffect(() => {
    refreshSpace().catch((error) => {
      handleAuthFailure(error);
    });
  }, [refreshSpace, handleAuthFailure]);

  useEffect(() => {
    refreshConversations().catch(() => undefined);
  }, [refreshConversations]);

  useEffect(() => {
    if (activeConvId == null) {
      setMessages([]);
      return;
    }
    loadMessages(activeConvId).catch(() => undefined);
  }, [activeConvId, loadMessages]);

  async function addSource() {
    setIsAddingSource(true);
    setSourceError("");
    setSourceStatus(
      tab === "file"
        ? "正在上传并嵌入媒体…"
        : tab === "path"
          ? "正在解析本地 PDF 并嵌入…"
          : "正在嵌入资料…",
    );
    try {
      let data: {
        source?: Record<string, unknown>;
        sources?: Array<Record<string, unknown>>;
        space?: unknown;
      };
      if (tab === "text") {
        data = await apiFetch("/sources/text", token, {
          method: "POST",
          body: JSON.stringify({ title, text, modality: "text" }),
        });
      } else if (tab === "url") {
        data = await apiFetch("/sources/url", token, {
          method: "POST",
          body: JSON.stringify({ url, title: title || undefined }),
        });
      } else if (tab === "path") {
        const trimmedPath = filePath.trim();
        if (!trimmedPath) {
          setSourceStatus("");
          setSourceError("请填写后端可访问的文件夹路径（内含 PDF）。");
          return;
        }
        data = await apiFetch(
          `/sources/file_inner?file_path=${encodeURIComponent(trimmedPath)}`,
          token,
          { method: "POST" },
        );
      } else {
        const file = fileRef.current?.files?.[0];
        if (!file) {
          setSourceStatus("");
          setSourceError("请先选择文件。");
          return;
        }
        const form = new FormData();
        form.append("title", title || file.name);
        form.append("file", file);
        form.append("notes", notes);
        data = await apiFetch("/sources/file", token, { method: "POST", body: form });
      }

      setSpace(normalizeSpace(data.space));
      if (tab === "path") {
        const added = Array.isArray(data.sources) ? data.sources : [];
        const preview = added
          .slice(0, 3)
          .map((item) => String(item.title || "资料"))
          .join("、");
        const more = added.length > 3 ? " 等" : "";
        setSourceStatus(
          added.length
            ? `已入库 ${added.length} 份 PDF${preview ? `：${preview}${more}` : ""}。`
            : "未入库任何 PDF。",
        );
      } else {
        setSourceStatus(`「${data.source?.title || "资料"}」已嵌入向量空间。`);
      }
    } catch (error) {
      handleAuthFailure(error);
      setSourceError(error instanceof Error ? error.message : "资料入库失败。");
    } finally {
      setIsAddingSource(false);
    }
  }

  async function removeSource(source: RackSource) {
    const confirmed = window.confirm(`确定从向量空间中删除「${source.title}」吗？`);
    if (!confirmed) return;

    setRemovingSourceId(source.id);
    setSourceError("");
    try {
      const data = await apiFetch<{ space?: unknown }>(`/sources/${source.id}`, token, { method: "DELETE" });
      setSpace(normalizeSpace(data.space));
      setMatches((current) => current.filter((match) => match.source_id !== source.id));
      if (selectedPoint?.source_id === source.id) setSelectedPoint(null);
      if (queryPoint) setQueryPoint(null);
      setSourceStatus(`已删除「${source.title}」。`);
    } catch (error) {
      handleAuthFailure(error);
      setSourceError(error instanceof Error ? error.message : "删除失败。");
    } finally {
      setRemovingSourceId(null);
    }
  }

  async function sendChatMessage() {
    const text = chatDraft.trim();
    if (!text || isSending) return;

    setIsSending(true);
    setChatError("");
    setStreamingText("");
    setChatDraft("");

    const optimisticUser: ChatMessage = {
      id: -Date.now(),
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimisticUser]);

    let nextConvId = activeConvId;
    let assembled = "";

    try {
      await streamChat(token, { message: text, conv_id: activeConvId }, (payload) => {
        if (payload.kind === "conv_id") {
          nextConvId = payload.convId;
          setActiveConvId(payload.convId);
          return;
        }
        if (payload.kind === "text") {
          assembled += payload.text;
          setStreamingText(assembled);
          return;
        }
      });

      if (nextConvId != null) {
        await loadMessages(nextConvId);
        await refreshConversations();
      }
    } catch (error) {
      handleAuthFailure(error);
      setChatError(error instanceof Error ? error.message : "发送失败，请稍后重试。");
      if (activeConvId != null) {
        await loadMessages(activeConvId).catch(() => undefined);
      } else {
        setMessages((current) => current.filter((item) => item.id !== optimisticUser.id));
      }
    } finally {
      setStreamingText("");
      setIsSending(false);
    }
  }

  function startNewChat() {
    setActiveConvId(null);
    setMessages([]);
    setChatDraft("");
    setStreamingText("");
    setChatError("");
  }

  async function handleSelectConversation(convId: number) {
    setActiveConvId(convId);
    setChatError("");
  }

  async function handleDeleteConversation(convId: number) {
    const target = conversations.find((item) => item.id === convId);
    const label = target?.title || `会话 #${convId}`;
    const confirmed = window.confirm(`确定删除「${label}」吗？`);
    if (!confirmed) return;

    setDeletingConvId(convId);
    setChatError("");
    try {
      await deleteConversation(token, convId);
      if (activeConvId === convId) {
        startNewChat();
      }
      await refreshConversations();
    } catch (error) {
      handleAuthFailure(error);
      setChatError(error instanceof Error ? error.message : "删除会话失败。");
    } finally {
      setDeletingConvId(null);
    }
  }

  /** 资料库调试：一次性 /ask（含引用、轨迹、空间点） */
  async function askOnce() {
    if (!question.trim()) return;
    setIsAsking(true);
    setQaError("");
    setQaStatus("正在检索证据并请求 ADK 协调器（/ask）…");
    setAnswer("");
    try {
      const data = (await apiFetch("/ask", token, {
        method: "POST",
        body: JSON.stringify({ question, top_k: 6 }),
      })) as AskResponse;
      setAnswer(data.answer);
      setMatches(data.matches ?? []);
      setTrace(data.trace ?? []);
      setQueryPoint(data.query_point ?? null);
      if (data.space) setSpace(normalizeSpace(data.space));
      setQaStatus(`已检索到 ${(data.matches ?? []).length} 条引用。`);
    } catch (error) {
      handleAuthFailure(error);
      setQaError(error instanceof Error ? error.message : "出错了，请稍后重试。");
    } finally {
      setIsAsking(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <BrainCircuit size={22} />
          </div>
          <div>
            <h1>个人资料助手</h1>
            <p>多模态 Agentic RAG · Gemini Embedding 2 · Google ADK</p>
          </div>
        </div>
        <div className="status-strip">
          <div className="workspace-tabs" role="tablist" aria-label="工作区视图">
            <button
              type="button"
              role="tab"
              className={workspaceView === "chat" ? "active" : ""}
              aria-selected={workspaceView === "chat"}
              onClick={() => setWorkspaceView("chat")}
            >
              <MessageSquare size={14} /> 聊天
            </button>
            <button
              type="button"
              role="tab"
              className={workspaceView === "library" ? "active" : ""}
              aria-selected={workspaceView === "library"}
              onClick={() => setWorkspaceView("library")}
            >
              <FolderOpen size={14} /> 资料库
            </button>
          </div>
          <span><RadioTower size={14} /> {provider}</span>
          <span><Box size={14} /> {pointCount} 个点</span>
          <span><Activity size={14} /> {sourceCount} 份资料</span>
          <span className="user-chip">{username}</span>
          <button className="icon-button logout-button" onClick={onLogout} aria-label="退出登录" title="退出登录">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {workspaceView === "chat" ? (
        <section className="workspace workspace-chat">
          <ConversationSidebar
            conversations={conversations}
            activeId={activeConvId}
            loading={conversationsLoading}
            deletingId={deletingConvId}
            onSelect={handleSelectConversation}
            onNew={startNewChat}
            onDelete={handleDeleteConversation}
          />
          <ChatPanel
            messages={messages}
            draft={chatDraft}
            streamingText={streamingText}
            isSending={isSending || messagesLoading}
            error={chatError}
            convId={activeConvId}
            onDraftChange={setChatDraft}
            onSend={sendChatMessage}
          />
        </section>
      ) : (
      <section className="workspace">
        <aside className="left-rail">
          <section className="panel source-list">
            <div className="panel-heading source-list-heading">
              <div>
                <h2>已入库资料</h2>
                <p>不再需要的资料可从向量空间中删除。</p>
              </div>
            </div>
            {space?.sources.map((source) => (
              <SourceRow
                source={source}
                key={source.id}
                isRemoving={removingSourceId === source.id}
                onRemove={removeSource}
              />
            ))}
          </section>

          <section className="panel source-panel">
            <div className="panel-heading">
              <div>
                <h2>添加资料</h2>
                <p>将新证据嵌入共享向量空间。</p>
              </div>
              <button className="icon-button" onClick={() => refreshSpace().catch(handleAuthFailure)} aria-label="刷新嵌入空间">
                <Activity size={16} />
              </button>
            </div>

            <div className="tabs" role="tablist">
              <button className={tab === "text" ? "active" : ""} onClick={() => setTab("text")}><FileText size={14} />文本</button>
              <button className={tab === "url" ? "active" : ""} onClick={() => setTab("url")}><Link size={14} />链接</button>
              <button className={tab === "file" ? "active" : ""} onClick={() => setTab("file")}><Upload size={14} />上传</button>
              <button className={tab === "path" ? "active" : ""} onClick={() => setTab("path")}><FolderOpen size={14} />路径</button>
            </div>

            {tab !== "path" && (
              <>
                <label className="field-label">标题</label>
                <input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="资料标题" />
              </>
            )}

            {tab === "text" && (
              <>
                <label className="field-label">正文</label>
                <textarea value={text} onChange={(event) => setText(event.target.value)} aria-label="资料正文" />
              </>
            )}

            {tab === "url" && (
              <>
                <label className="field-label">网址</label>
                <input value={url} onChange={(event) => setUrl(event.target.value)} aria-label="网址资料" />
              </>
            )}

            {tab === "file" && (
              <>
                <label className="field-label">文件</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.md,.pdf,image/*,audio/*,video/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setSelectedFile(file);
                    if (file && title === DEFAULT_TITLE) setTitle(file.name);
                  }}
                />
                {selectedFile && (
                  <div className="file-preview">
                    <Video size={15} />
                    <span>{selectedFile.name}</span>
                    <strong>{selectedFile.type || "文件"} · {formatBytes(selectedFile.size)}</strong>
                  </div>
                )}
                <label className="field-label">备注</label>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} aria-label="文件备注" />
              </>
            )}

            {tab === "path" && (
              <>
                <label className="field-label">文件夹路径</label>
                <input
                  value={filePath}
                  onChange={(event) => setFilePath(event.target.value)}
                  placeholder="例如 C:\Users\LJ\Desktop\数学资料"
                  aria-label="本地 PDF 文件夹路径"
                />
                <p className="field-hint">
                  调用 /sources/file_inner：路径须是后端机器可访问的文件夹，会递归解析其中全部 PDF，每个文件入库为一份资料。
                </p>
              </>
            )}

            <button className="primary-button" onClick={addSource} disabled={isAddingSource}>
              {isAddingSource ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
              {tab === "path" ? "解析并入库" : "添加资料"}
            </button>
            {(sourceStatus || sourceError) && (
              <div className={`inline-status ${sourceError ? "error" : "success"}`} role="status">
                {sourceError || sourceStatus}
              </div>
            )}
          </section>
        </aside>

        <section className="space-stage">
          <div className="stage-header">
            <div>
              <h2>嵌入空间</h2>
              <p>{space?.dimensions ?? 768} 维向量 · {projection} · 每份资料一个点</p>
            </div>
            <div className="stage-tools">
              <div className="modality-key" aria-label="模态图例">
                {modalityLabels.map((item) => (
                  <span key={item.key} className={`modality-key-item key-${item.key}`}>{item.label}</span>
                ))}
              </div>
              <div className="space-readout" aria-label="嵌入空间状态">
                <span>{sourceCount} 份资料</span>
                <span>{matches.length ? `命中 ${matches.length} 条` : "就绪"}</span>
              </div>
            </div>
          </div>
          <VectorSpace
            points={points}
            queryPoint={queryPoint}
            matches={matches}
            selectedId={selectedPoint?.id ?? null}
            onSelect={setSelectedPoint}
          />
          {selectedPoint && (
            <div className="hover-card">
              <div className={`mini-dot ${selectedPoint.modality}`} />
              <strong>{selectedPoint.title}</strong>
              <span>{modalityName[selectedPoint.modality] || selectedPoint.modality} · {selectedPoint.id}</span>
              <p>{selectedPoint.preview}</p>
            </div>
          )}
        </section>

        <aside className="right-rail">
          <section className="panel qa-panel">
            <div className="panel-heading">
              <div>
                <h2>问答调试</h2>
                <p>一次性 /ask · 含引用与轨迹</p>
              </div>
              <Bot size={18} />
            </div>
            <label className="field-label">问题</label>
            <textarea className="question-box" value={question} onChange={(event) => setQuestion(event.target.value)} aria-label="问题" />
            <div className="qa-actions" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button className="primary-button" onClick={askOnce} disabled={isAsking}>
                {isAsking ? <Loader2 className="spin" size={16} /> : <Search size={16} />} 一次性问答
              </button>
            </div>
            {(qaStatus || qaError) && (
              <div className={`inline-status ${qaError ? "error" : "success"}`} role="status">
                {qaError || qaStatus}
              </div>
            )}
            <div className="answer-box prominent-answer">
              <MessageSquare size={16} />
              <AnswerContent answer={answer} />
            </div>
          </section>

          <section className="panel trace-panel">
            <div className="panel-heading">
              <div>
                <h2>智能体轨迹</h2>
                <p>Google ADK 工具调用路径</p>
              </div>
              <Sparkles size={18} />
            </div>
            <div className="trace-list">
              {(trace.length ? trace : [
                { agent: "资料入库", status: "ready", detail: "等待提问" },
                { agent: "检索工具", status: "ready", detail: "最近邻证据将显示在这里" },
                { agent: "回答合成", status: "ready", detail: "带引用的回答输出目标" },
              ]).map((step) => (
                <div className="trace-row" key={step.agent}>
                  <span>{step.agent}</span>
                  <p>{step.detail}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="panel citations-panel">
            <div className="panel-heading">
              <div>
                <h2>引用</h2>
                <p>本次回答使用的资料</p>
              </div>
            </div>
            <div className="citation-list">
              {matches.length === 0 && <div className="empty-state">还没有提问。先添加资料，再提出问题。</div>}
              {matches.map((match) => {
                const Icon = modalityIcon[match.modality] || FileText;
                return (
                  <button
                    className="citation-row"
                    key={match.id}
                    onMouseEnter={() => setSelectedPoint({ ...match, color: "#f54e00", preview: match.text, projection: match.projection ?? { x: 0, y: 0, z: 0 } })}
                    onMouseLeave={() => setSelectedPoint(null)}
                  >
                    <div className="citation-top">
                      <span><Icon size={14} /> {match.title}</span>
                      <strong>{scorePct(match.score)}</strong>
                    </div>
                    <div className="score-track" aria-hidden="true"><div style={{ width: scorePct(match.score) }} /></div>
                    <p>{match.text}</p>
                  </button>
                );
              })}
            </div>
          </section>
        </aside>
      </section>
      )}
    </main>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [username, setUsername] = useState(() => localStorage.getItem(USER_KEY) || "");

  function handleAuth(accessToken: string, user: string) {
    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(USER_KEY, user);
    setToken(accessToken);
    setUsername(user);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUsername("");
  }

  if (!token) {
    return <AuthScreen onAuth={handleAuth} />;
  }

  return <Workspace token={token} username={username} onLogout={logout} />;
}
