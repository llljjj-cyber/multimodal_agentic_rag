import { RotateCcw } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

export type SpacePoint = {
  id: string;
  source_id: string;
  title: string;
  modality: string;
  projection: { x: number; y: number; z: number };
  color?: string;
  preview?: string;
};

type Props = {
  points: SpacePoint[];
  queryPoint?: SpacePoint | null;
  highlightSourceIds?: Set<string>;
  selectedId?: string | null;
  hoveredId?: string | null;
  onSelect?: (point: SpacePoint | null) => void;
  onHover?: (point: SpacePoint | null, position?: { x: number; y: number }) => void;
  onContextMenu?: (point: SpacePoint, position: { x: number; y: number }) => void;
  viewSwitch?: ReactNode;
};

const MODALITY_COLORS: Record<string, string> = {
  text: "#2d6a4f",
  url: "#1e40af",
  pdf: "#92400e",
  txt: "#92400e",
  md: "#5b21b6",
  query: "#15616d",
};

const MODALITY_LEGEND: Array<{ key: string; label: string }> = [
  { key: "text", label: "文本" },
  { key: "url", label: "网页" },
  { key: "pdf", label: "PDF" },
  { key: "txt", label: "TXT" },
  { key: "md", label: "Markdown" },
];

const MERIDIAN = {
  paper: 0xfaf7f2,
  accent: 0x15616d,
  gridMinor: 0xe5ddd2,
  axisX: 0x15616d,
  axisY: 0x2d6a4f,
  axisZ: 0x1e40af,
  dust: 0x78716c,
  query: "#15616d",
};

const DEFAULT_CAMERA = {
  position: new THREE.Vector3(0, 1.9, 9.2),
  target: new THREE.Vector3(0, 0, 0),
};

const DRAG_THRESHOLD_PX = 6;
const POINT_SCALE = 1.35;

function indexFromId(id: string) {
  return Array.from(id).reduce((total, char) => total + char.charCodeAt(0), 0);
}

/** 把点云平移到原点附近，便于摄像机对准中心 */
function layoutPoints(points: SpacePoint[]) {
  const raw = points.map(
    (point) =>
      new THREE.Vector3(
        point.projection.x * POINT_SCALE,
        point.projection.y * POINT_SCALE,
        point.projection.z * POINT_SCALE,
      ),
  );
  const center = new THREE.Vector3();
  if (raw.length > 0) {
    raw.forEach((vector) => center.add(vector));
    center.divideScalar(raw.length);
  }
  const positions = raw.map((vector) => vector.sub(center));
  let radius = 0;
  positions.forEach((vector) => {
    radius = Math.max(radius, vector.length());
  });
  return { positions, radius: Math.max(radius, 1.2) };
}

function cameraForRadius(radius: number) {
  const distance = Math.max(5, Math.min(14, radius * 2.6 + 3));
  return {
    position: new THREE.Vector3(distance * 0.32, distance * 0.26, distance * 0.9),
    target: new THREE.Vector3(0, 0, 0),
  };
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

function pointColor(point: SpacePoint) {
  return point.color || MODALITY_COLORS[point.modality] || "#78716c";
}

function pointerNdc(event: PointerEvent, rect: DOMRect, out: THREE.Vector2) {
  out.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  out.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

export default function SpaceCanvas({
  points,
  queryPoint,
  highlightSourceIds,
  selectedId = null,
  hoveredId = null,
  onSelect,
  onHover,
  onContextMenu,
  viewSwitch,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const resetViewRef = useRef<(() => void) | null>(null);
  const pointMapRef = useRef<Map<string, SpacePoint>>(new Map());
  const selectedIdRef = useRef<string | null>(selectedId);
  const hoveredIdRef = useRef<string | null>(hoveredId);
  const highlightRef = useRef<Set<string> | undefined>(highlightSourceIds);
  const onSelectRef = useRef(onSelect);
  const onHoverRef = useRef(onHover);
  const onContextMenuRef = useRef(onContextMenu);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    hoveredIdRef.current = hoveredId;
  }, [hoveredId]);

  useEffect(() => {
    highlightRef.current = highlightSourceIds;
  }, [highlightSourceIds]);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onHoverRef.current = onHover;
    onContextMenuRef.current = onContextMenu;
  }, [onSelect, onHover, onContextMenu]);

  useEffect(() => {
    if (!mountRef.current) return;

    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(MERIDIAN.paper, 9, 26);

    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 0.55;
    controls.minDistance = 4;
    controls.maxDistance = 18;
    controls.maxPolarAngle = Math.PI * 0.88;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    const applyCamera = (position: THREE.Vector3, target: THREE.Vector3) => {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
    };

    const glowTexture = makeGlowTexture();
    const allPoints = queryPoint ? [...points, queryPoint] : points;
    pointMapRef.current = new Map(allPoints.map((point) => [point.id, point]));
    const { positions: laidOut, radius } = layoutPoints(allPoints);
    const framed = allPoints.length > 0 ? cameraForRadius(radius) : DEFAULT_CAMERA;
    applyCamera(framed.position, framed.target);

    resetViewRef.current = () => {
      const next = allPoints.length > 0 ? cameraForRadius(radius) : DEFAULT_CAMERA;
      applyCamera(next.position.clone(), next.target.clone());
    };

    const frameGroup = new THREE.Group();
    const pointGroup = new THREE.Group();
    const linkGroup = new THREE.Group();
    scene.add(frameGroup);
    scene.add(linkGroup);
    scene.add(pointGroup);

    const grid = new THREE.GridHelper(10, 20, MERIDIAN.accent, MERIDIAN.gridMinor);
    grid.position.y = -2.8;
    grid.material.opacity = 0.22;
    grid.material.transparent = true;
    frameGroup.add(grid);

    const axes = [
      [new THREE.Vector3(-4.8, -2.6, -2.8), new THREE.Vector3(4.8, -2.6, -2.8), MERIDIAN.axisX],
      [new THREE.Vector3(-4.8, -2.6, -2.8), new THREE.Vector3(-4.8, 2.8, -2.8), MERIDIAN.axisY],
      [new THREE.Vector3(-4.8, -2.6, -2.8), new THREE.Vector3(-4.8, -2.6, 2.8), MERIDIAN.axisZ],
    ] as const;
    axes.forEach(([start, end, color]) => {
      const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
      const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 });
      frameGroup.add(new THREE.Line(geometry, material));
    });

    const backdropGeometry = new THREE.BufferGeometry();
    const backdropPositions = new Float32Array(120 * 3);
    for (let index = 0; index < 120; index += 1) {
      backdropPositions[index * 3] = (Math.random() - 0.5) * 12;
      backdropPositions[index * 3 + 1] = (Math.random() - 0.5) * 7;
      backdropPositions[index * 3 + 2] = (Math.random() - 0.5) * 9;
    }
    backdropGeometry.setAttribute("position", new THREE.BufferAttribute(backdropPositions, 3));
    frameGroup.add(
      new THREE.Points(
        backdropGeometry,
        new THREE.PointsMaterial({ color: MERIDIAN.dust, size: 0.012, transparent: true, opacity: 0.2 }),
      ),
    );

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.12 };
    const pointer = new THREE.Vector2();
    const meshes: THREE.Mesh[] = [];
    const halos: THREE.Sprite[] = [];
    const linkLines: THREE.Line[] = [];
    const meshBySourceId = new Map<string, THREE.Mesh>();
    const objectsById = new Map<
      string,
      { halo?: THREE.Sprite; base: THREE.Vector3; orbit: number; phase: number; speed: number }
    >();

    let orbiting = true;
    controls.addEventListener("start", () => {
      orbiting = false;
      renderer.domElement.style.cursor = "grabbing";
    });
    controls.addEventListener("end", () => {
      orbiting = true;
      renderer.domElement.style.cursor = "grab";
    });

    allPoints.forEach((point, index) => {
      const position = laidOut[index] ?? new THREE.Vector3();
      const isQuery = point.modality === "query";
      const isMatched = highlightRef.current?.has(point.source_id) ?? false;
      const color = pointColor(point);

      if (isQuery || isMatched) {
        const haloMaterial = new THREE.SpriteMaterial({
          map: glowTexture,
          color: new THREE.Color(isQuery ? MERIDIAN.query : color),
          transparent: true,
          opacity: isQuery ? 0.34 : 0.22,
          depthWrite: false,
        });
        const halo = new THREE.Sprite(haloMaterial);
        halo.position.copy(position);
        halo.scale.setScalar(isQuery ? 0.76 : 0.58);
        halo.userData.baseScale = isQuery ? 0.76 : 0.58;
        halo.userData.baseOpacity = isQuery ? 0.34 : 0.22;
        halo.userData.id = point.id;
        halos.push(halo);
        pointGroup.add(halo);
      }

      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(isQuery ? 0.09 : 0.08, 24, 24),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color),
          transparent: true,
          opacity: isQuery ? 1 : 0.92,
        }),
      );
      mesh.position.copy(position);
      mesh.userData.id = point.id;
      mesh.userData.sourceId = point.source_id;
      meshes.push(mesh);
      pointGroup.add(mesh);
      meshBySourceId.set(point.source_id, mesh);
      objectsById.set(point.id, {
        halo: halos.find((item) => item.userData.id === point.id),
        base: position.clone(),
        orbit: isQuery ? 0.024 : 0.06 + (indexFromId(point.id) % 5) * 0.01,
        phase: (indexFromId(point.id) % 13) * 0.62,
        speed: isQuery ? 0.24 : 0.3 + (indexFromId(point.id) % 7) * 0.03,
      });
    });

    if (queryPoint) {
      const queryMesh = meshBySourceId.get(queryPoint.source_id);
      if (queryMesh) {
        highlightRef.current?.forEach((sourceId) => {
          const target = meshBySourceId.get(sourceId);
          if (!target || sourceId === queryPoint.source_id) return;
          const geometry = new THREE.BufferGeometry().setFromPoints([
            queryMesh.position.clone(),
            target.position.clone(),
          ]);
          const line = new THREE.Line(
            geometry,
            new THREE.LineBasicMaterial({ color: MERIDIAN.accent, transparent: true, opacity: 0.22 }),
          );
          line.userData.targetSourceId = sourceId;
          linkLines.push(line);
          linkGroup.add(line);
        });
      }
    }

    const pickPoint = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return undefined;
      pointerNdc(event, rect, pointer);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(meshes)[0];
    };

    const updateCursor = (event: PointerEvent) => {
      if (!orbiting) return;
      const hit = pickPoint(event);
      renderer.domElement.style.cursor = hit ? "pointer" : "grab";
      const point = hit ? pointMapRef.current.get(hit.object.userData.id) ?? null : null;
      onHoverRef.current?.(point, point ? { x: event.clientX, y: event.clientY } : undefined);
    };

    let pointerDownX = 0;
    let pointerDownY = 0;

    const handlePointerDown = (event: PointerEvent) => {
      pointerDownX = event.clientX;
      pointerDownY = event.clientY;
    };

    const handlePointerMove = (event: PointerEvent) => {
      updateCursor(event);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const dx = event.clientX - pointerDownX;
      const dy = event.clientY - pointerDownY;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) return;

      const hit = pickPoint(event);
      onSelectRef.current?.(hit ? pointMapRef.current.get(hit.object.userData.id) ?? null : null);
      updateCursor(event);
    };

    const handleContextMenu = (event: MouseEvent) => {
      const hit = pickPoint(event as unknown as PointerEvent);
      const point = hit ? pointMapRef.current.get(hit.object.userData.id) : undefined;
      if (!point || point.modality === "query") return;
      event.preventDefault();
      onContextMenuRef.current?.(point, { x: event.clientX, y: event.clientY });
    };

    const handlePointerLeave = () => {
      onHoverRef.current?.(null);
    };

    renderer.domElement.style.cursor = "grab";
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("contextmenu", handleContextMenu);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (width <= 0 || height <= 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    resize();
    window.addEventListener("resize", resize);
    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(mount);

    let frame = 0;
    let animation = 0;
    const animate = () => {
      frame += 0.01;
      controls.update();

      meshes.forEach((mesh, index) => {
        const object = objectsById.get(mesh.userData.id);
        if (object && orbiting) {
          const theta = frame * object.speed + object.phase;
          const bob = Math.sin(frame * object.speed * 1.7 + object.phase) * object.orbit * 0.35;
          mesh.position.set(
            object.base.x + Math.cos(theta) * object.orbit,
            object.base.y + bob,
            object.base.z + Math.sin(theta) * object.orbit,
          );
          object.halo?.position.copy(mesh.position);
        }
        const pulse = 1 + Math.sin(frame * 2.2 + index) * 0.045;
        const active =
          mesh.userData.id === selectedIdRef.current || mesh.userData.id === hoveredIdRef.current;
        mesh.scale.setScalar(active ? 1.24 : pulse);
      });

      linkLines.forEach((line) => {
        const sourceMesh = queryPoint ? meshBySourceId.get(queryPoint.source_id) : undefined;
        const targetMesh = meshBySourceId.get(String(line.userData.targetSourceId));
        if (!sourceMesh || !targetMesh) return;
        const positions = line.geometry.getAttribute("position") as THREE.BufferAttribute;
        positions.setXYZ(0, sourceMesh.position.x, sourceMesh.position.y, sourceMesh.position.z);
        positions.setXYZ(1, targetMesh.position.x, targetMesh.position.y, targetMesh.position.z);
        positions.needsUpdate = true;
      });

      halos.forEach((halo, index) => {
        const base = halo.userData.baseScale || 0.58;
        const pulse = 1 + Math.sin(frame * 1.7 + index) * 0.07;
        halo.scale.setScalar(base * pulse);
        const material = halo.material as THREE.SpriteMaterial;
        const active =
          halo.userData.id === selectedIdRef.current || halo.userData.id === hoveredIdRef.current;
        material.opacity = active ? 0.48 : halo.userData.baseOpacity;
      });

      renderer.render(scene, camera);
      animation = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animation);
      resetViewRef.current = null;
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("contextmenu", handleContextMenu);
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
      controls.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      glowTexture.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
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
  }, [points, queryPoint]);

  return (
    <div className="space-canvas-wrap">
      <div className="vector-canvas" ref={mountRef} aria-label="资料空间" />

      <div className="space-controls space-controls--left">
        <button
          type="button"
          className="space-reset-btn"
          onClick={() => resetViewRef.current?.()}
          title="重置视角"
        >
          <RotateCcw size={14} />
          重置视角
        </button>
        <span className="space-controls-hint">拖拽旋转 · 滚轮缩放 · 悬停预览 · 右键操作</span>
      </div>

      {viewSwitch && <div className="space-controls space-controls--right">{viewSwitch}</div>}

      <div className="space-overlay">
        <div className="space-legend">
          <span className="legend-item legend-pca">资料空间</span>
          {MODALITY_LEGEND.map(({ key, label }) => (
            <span key={key} className="legend-item">
              <span className="legend-dot" style={{ background: MODALITY_COLORS[key] }} />
              {label}
            </span>
          ))}
          {queryPoint && (
            <span className="legend-item">
              <span className="legend-dot" style={{ background: MODALITY_COLORS.query }} />
              查询
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export { MODALITY_COLORS };
