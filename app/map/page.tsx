"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ALL_LANES, assignLane } from "@/lib/lanes";

/* ===== LEGACY: React Flowツリー表示で使用していたimport(未使用、参照用に保持) =====
import { useRouter } from "next/navigation";
import ReactFlow, {
  Node, Edge,
  Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  EdgeProps, getBezierPath, useReactFlow,
  ReactFlowProvider,
} from "reactflow";
===== LEGACY ここまで ===== */

// ---- 型定義 ----
/* ===== LEGACY: React Flowノード用データ型(未使用、参照用に保持) =====
interface MindmapNodeData {
  id: string;
  meetingId: string;
  parentId: string | null;
  label: string;
  nodeType: string;
  hasChildren: boolean;
  collapsed: boolean;
  isStarred: boolean;
  onToggle: (id: string) => void;
  onHide: (id: string) => void;
  onStar: (id: string, current: boolean) => void;
}
===== LEGACY ここまで ===== */

interface CrossLinkData {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  strength: "strong" | "medium" | "weak";
  category: string | null;
  categoryColor: string;
  reason: string | null;
  newValueSuggestion: string | null;
  isAiGenerated: boolean;
  isAccepted: boolean | null;
  fromNode: { id: string; label: string; nodeType: string; meetingId: string };
  toNode: { id: string; label: string; nodeType: string; meetingId: string };
  onClick?: (cl: CrossLinkData) => void;
}

interface MindmapNodeRaw {
  id: string;
  parentId: string | null;
  label: string;
  nodeType: string;
  isVisible: boolean;
  isStarred: boolean;
  sortOrder: number | null;
}

interface Meeting {
  id: string;
  title: string | null;
  date: string;
  mindmapNodes: MindmapNodeRaw[];
  meetingContacts: { contact: { id: string; name: string; organization: string | null } }[];
}

// ---- スイムレーンマップ用の型 ----
interface OverviewTag {
  id: string;
  name: string;
  status: string;
}

interface OverviewMeeting {
  id: string;
  title: string | null;
  date: string;
  createdAt: string;
  nodeCount: number;
  tags: OverviewTag[];
}

interface OverviewCrossLink {
  id: string;
  fromMeetingId: string;
  toMeetingId: string;
  strength: "strong" | "medium" | "weak";
  sharedTags: string[];
}

interface ExpandedNode {
  id: string;
  label: string;
  nodeType: string;
  isStarred: boolean;
}

// ---- スイムレーンレイアウト定数 ----
const MIN_LANE_HEIGHT = 64;
const NODE_HEIGHT_COMPACT = 36; // ズームアウト時(タイトル1行)のノード実高さ
const NODE_HEIGHT_FULL = 70; // ズームイン時(タイトル最大3行)のノード実高さ
const NODE_TITLE_LINES_FULL = 3;
const NODE_TOP_MARGIN = 12;
const NODE_BOTTOM_MARGIN = 6;
const MAX_LEVELS_HARD_CAP = 12;
const SWIMLANE_NODE_WIDTH = 160;
const COLLISION_THRESHOLD = SWIMLANE_NODE_WIDTH; // ノード幅そのもの。これ未満の距離なら箱が物理的に重なる
const TIMELINE_PADDING = 60;
const MIN_TIMELINE_WIDTH = 900;
const MONTH_WIDTH = 300;
const MONTH_HEADER_HEIGHT = 32;
const LANE_LABEL_WIDTH = 112;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 6;
const ZOOM_SEMANTIC_THRESHOLD = 1.5;

interface MonthTick {
  key: string;
  year: number;
  month: number; // 1-12
  showYear: boolean;
}

function getMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 会議日時の範囲から、抜けなく連続した月のリストを作る(会議がない月も含む)
function buildMonthRange(meetings: OverviewMeeting[]): MonthTick[] {
  if (meetings.length === 0) return [];
  const times = meetings.map((m) => new Date(m.createdAt).getTime());
  const minD = new Date(Math.min(...times));
  const maxD = new Date(Math.max(...times));
  const months: MonthTick[] = [];
  let y = minD.getFullYear();
  let m = minD.getMonth();
  const endY = maxD.getFullYear();
  const endM = maxD.getMonth();
  let prevYear: number | null = null;
  while (y < endY || (y === endY && m <= endM)) {
    months.push({ key: `${y}-${String(m + 1).padStart(2, "0")}`, year: y, month: m + 1, showYear: prevYear !== y });
    prevYear = y;
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return months;
}

// 同レーン内でX座標が近いノードを検出し、重ならないよう縦方向のレベルを割り当てる。
// レベル数はハードキャップまで無制限(実際に必要な数だけ使う)。
// ズームでX間隔が広がるほど衝突するアイテムが減り、必要レベル数は自然に減っていく
function resolveCollisionLevels(items: { id: string; x: number }[]): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const placed: { x: number; level: number }[] = [];
  const result = new Map<string, number>();
  sorted.forEach((item) => {
    const usedLevels = new Set(
      placed.filter((p) => Math.abs(p.x - item.x) < COLLISION_THRESHOLD).map((p) => p.level)
    );
    let level = 0;
    while (usedLevels.has(level) && level < MAX_LEVELS_HARD_CAP - 1) level++;
    result.set(item.id, level);
    placed.push({ x: item.x, level });
  });
  return result;
}

interface SwimlaneLayout {
  months: MonthTick[];
  width: number;
  laneHeight: number;
  totalHeight: number;
  monthWidth: number;
  padding: number;
  nodePositions: Map<string, { x: number; y: number; laneId: string }>;
}

// laneHeightは画面の高さから決まる固定値として外から渡す(縦スクロールを出さないため)。
// zoomはX方向(月の幅)にのみ効かせる。
function computeSwimlaneLayout(meetings: OverviewMeeting[], zoom: number, laneHeight: number): SwimlaneLayout {
  const months = buildMonthRange(meetings);
  const totalHeight = laneHeight * ALL_LANES.length;
  const monthWidth = MONTH_WIDTH * zoom;
  const padding = TIMELINE_PADDING * zoom;
  if (months.length === 0) {
    return { months, width: MIN_TIMELINE_WIDTH * zoom, laneHeight, totalHeight, monthWidth, padding, nodePositions: new Map() };
  }

  const width = Math.max(MIN_TIMELINE_WIDTH * zoom, months.length * monthWidth) + padding * 2;

  // 月ごとにグループ化し、月内は等幅で日付順に配置(密集期間の詰まりすぎ・閑散期間の間延びを防ぐ)
  const byMonth = new Map<string, OverviewMeeting[]>();
  meetings.forEach((m) => {
    const key = getMonthKey(new Date(m.createdAt));
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(m);
  });

  const baseByLane = new Map<string, { id: string; x: number }[]>();
  months.forEach((monthInfo, monthIdx) => {
    const monthMeetings = (byMonth.get(monthInfo.key) ?? [])
      .slice()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const monthStartX = padding + monthIdx * monthWidth;
    const count = monthMeetings.length;
    monthMeetings.forEach((m, i) => {
      const fraction = count === 1 ? 0.5 : (i + 0.5) / count;
      const x = monthStartX + fraction * monthWidth;
      const laneId = assignLane(m.tags.map((tag) => tag.name));
      if (!baseByLane.has(laneId)) baseByLane.set(laneId, []);
      baseByLane.get(laneId)!.push({ id: m.id, x });
    });
  });

  // レーンごとに実際に必要なレベル数を求め、固定の利用可能高さをそのレベル数で
  // 均等分割する(必要レベルが少ないほど間隔が広がり、多いほど詰まるが高さは超えない)。
  // 間隔の下限はノードの実高さ(ズームで表示行数が変わる)とし、レベルが違えば
  // 縦方向も確実に離れるようにする(=箱として重ならないことを保証する)
  const usableHeight = Math.max(1, laneHeight - NODE_TOP_MARGIN - NODE_BOTTOM_MARGIN);
  const minSpacing = zoom >= ZOOM_SEMANTIC_THRESHOLD ? NODE_HEIGHT_FULL : NODE_HEIGHT_COMPACT;
  const nodePositions = new Map<string, { x: number; y: number; laneId: string }>();
  baseByLane.forEach((items, laneId) => {
    const laneIdx = ALL_LANES.findIndex((l) => l.id === laneId);
    const top = (laneIdx === -1 ? ALL_LANES.length - 1 : laneIdx) * laneHeight;
    const levels = resolveCollisionLevels(items);
    const neededLevels = Math.max(...Array.from(levels.values())) + 1;
    const spacing = Math.max(minSpacing, usableHeight / neededLevels);
    items.forEach((item) => {
      const level = levels.get(item.id) ?? 0;
      nodePositions.set(item.id, { x: item.x, y: top + NODE_TOP_MARGIN + level * spacing, laneId });
    });
  });

  return { months, width, laneHeight, totalHeight, monthWidth, padding, nodePositions };
}

function isClosedTopicMeeting(m: OverviewMeeting): boolean {
  return m.tags.some((t) => t.status === "closed" || t.status === "cancelled");
}

/* ===== LEGACY: React Flowツリー表示の定数(未使用、参照用に保持) =====
const NODE_HEIGHT = 38;
const NODE_GAP = 10;
const LEVEL_WIDTH = 200;
const MEETING_GAP = 60;

const NODE_COLORS: Record<string, string> = {
  root: "#4338ca",
  topic: "#6366f1",
  item: "#a5b4fc",
  action: "#f59e0b",
};
const STRENGTH_WIDTH: Record<string, number> = { strong: 4, medium: 3, weak: 2 };
const STRENGTH_DASH: Record<string, string> = { strong: "10,3", medium: "8,4", weak: "6,5" };

// ---- ツリー計算 ----
function calcSubtreeHeight(id: string, childMap: Map<string, string[]>, collapsed: Set<string>): number {
  if (collapsed.has(id)) return NODE_HEIGHT;
  const children = childMap.get(id) ?? [];
  if (children.length === 0) return NODE_HEIGHT;
  const sum = children.reduce((s, c) => s + calcSubtreeHeight(c, childMap, collapsed), 0);
  return Math.max(NODE_HEIGHT, sum + (children.length - 1) * NODE_GAP);
}

function assignPositions(
  id: string, x: number, centerY: number,
  childMap: Map<string, string[]>, collapsed: Set<string>,
  out: Map<string, { x: number; y: number }>
) {
  out.set(id, { x, y: centerY - NODE_HEIGHT / 2 });
  if (collapsed.has(id)) return;
  const children = childMap.get(id) ?? [];
  if (children.length === 0) return;
  const totalH = children.reduce((s, c) => s + calcSubtreeHeight(c, childMap, collapsed), 0)
    + (children.length - 1) * NODE_GAP;
  let curY = centerY - totalH / 2;
  for (const c of children) {
    const h = calcSubtreeHeight(c, childMap, collapsed);
    assignPositions(c, x + LEVEL_WIDTH, curY + h / 2, childMap, collapsed, out);
    curY += h + NODE_GAP;
  }
}

// ---- カスタムノード ----
function MindmapNodeComponent({ data }: { data: MindmapNodeData }) {
  const [hovered, setHovered] = useState(false);
  const bg = NODE_COLORS[data.nodeType] ?? "#6366f1";
  const isRoot = data.nodeType === "root";
  const isItem = data.nodeType === "item";

  return (
    <div
      style={{
        background: bg,
        color: isItem ? "#1e1b4b" : "white",
        borderRadius: 10,
        padding: isRoot ? "7px 14px" : "5px 10px",
        fontSize: isRoot ? 13 : 12,
        fontWeight: isRoot ? "bold" : "normal",
        minWidth: isRoot ? 130 : 100,
        maxWidth: 190,
        boxShadow: isRoot ? "0 2px 8px rgba(0,0,0,0.2)" : "0 1px 3px rgba(0,0,0,0.1)",
        display: "flex",
        alignItems: "center",
        gap: 4,
        userSelect: "none" as const,
        position: "relative",
      }}
      onMouseEnter={() => !isRoot && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => !isRoot && data.hasChildren && data.onToggle(data.id)}
    >
      {data.hasChildren && (
        <span style={{ fontSize: 10, opacity: 0.8, flexShrink: 0 }}>
          {data.collapsed ? "▶" : "▼"}
        </span>
      )}
      <span style={{ lineHeight: 1.3, wordBreak: "break-all" as const, flex: 1 }}>
        {data.label}
      </span>

      {(data.isStarred || hovered) && (
        <span
          title={data.isStarred ? "星を外す" : "クロスリンク候補にする"}
          style={{
            flexShrink: 0,
            fontSize: 11,
            cursor: "pointer",
            opacity: data.isStarred ? 1 : 0.6,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            data.onStar(data.id, data.isStarred);
          }}
        >
          {data.isStarred ? "⭐" : "☆"}
        </span>
      )}

      {hovered && (
        <span
          title="非表示にする"
          style={{
            flexShrink: 0,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "rgba(239,68,68,0.85)",
            color: "white",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            marginLeft: 2,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            data.onHide(data.id);
          }}
        >
          ×
        </span>
      )}
    </div>
  );
}

// ---- クロスリンクエッジ ----
function CrossLinkEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, targetX, targetY, curvature: 0.3 });
  const cl = data as CrossLinkData;
  const color = cl?.categoryColor ?? "#6366f1";
  const width = STRENGTH_WIDTH[cl?.strength] ?? 2;
  const dash = STRENGTH_DASH[cl?.strength] ?? "8,5";
  const opacity = cl?.isAccepted === null ? 0.85 : cl?.isAccepted ? 1 : 0.2;

  return (
    <>
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={16}
        onClick={() => cl?.onClick?.(cl)} style={{ cursor: "pointer" }} />
      <path id={id} d={edgePath} fill="none" stroke={color}
        strokeWidth={width} strokeDasharray={dash} opacity={opacity}
        onClick={() => cl?.onClick?.(cl)} style={{ cursor: "pointer" }} />
      <circle cx={sourceX} cy={sourceY} r={3} fill={color} opacity={opacity} />
      <circle cx={targetX} cy={targetY} r={3} fill={color} opacity={opacity} />
    </>
  );
}

const nodeTypes = { mindmap: MindmapNodeComponent };
const edgeTypes = { crossLink: CrossLinkEdge };
===== LEGACY ここまで ===== */

// ---- メインコンポーネント ----
function MapInner() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [crossLinks, setCrossLinks] = useState<CrossLinkData[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [analyzeResult, setAnalyzeResult] = useState("");
  const [view, setView] = useState<"map" | "list" | "person" | "theme" | "conflict" | "synthesis">("map");
  const [selectedCrossLink, setSelectedCrossLink] = useState<CrossLinkData | null>(null);

  // ---- スイムレーンマップ用の状態 ----
  const [swimlaneData, setSwimlaneData] = useState<{ meetings: OverviewMeeting[]; crossLinks: OverviewCrossLink[] }>({
    meetings: [],
    crossLinks: [],
  });
  const [swimlaneLoading, setSwimlaneLoading] = useState(true);
  const [swimlaneError, setSwimlaneError] = useState("");
  const [hiddenLanes, setHiddenLanes] = useState<Set<string>>(new Set());
  const [showClosed, setShowClosed] = useState(false);
  const [expandedMeetingId, setExpandedMeetingId] = useState<string | null>(null);
  const [expandedNodesCache, setExpandedNodesCache] = useState<Map<string, ExpandedNode[]>>(new Map());
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [hoveredMeetingId, setHoveredMeetingId] = useState<string | null>(null);
  const [zoom, setZoomState] = useState(1);
  const [availableHeight, setAvailableHeight] = useState(0);

  const swimlaneScrollRef = useRef<HTMLDivElement>(null);
  const hasScrolledInitially = useRef(false);
  const zoomRef = useRef(1);

  function setZoom(z: number) {
    zoomRef.current = z;
    setZoomState(z);
  }

  const laneHeight = Math.max(
    MIN_LANE_HEIGHT,
    Math.floor((availableHeight - MONTH_HEADER_HEIGHT) / ALL_LANES.length)
  );

  const swimlaneLayout = useMemo(
    () => computeSwimlaneLayout(swimlaneData.meetings, zoom, laneHeight),
    [swimlaneData.meetings, zoom, laneHeight]
  );

  // スイムレーン領域の実測高さを取得(レーン高さ = 画面の高さ ÷ レーン数、に使う)。
  // リサイズ・画面回転でも再計算する
  useEffect(() => {
    const el = swimlaneScrollRef.current;
    if (!el) return;
    function measure() {
      if (el) setAvailableHeight(el.clientHeight);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  function scrollToInitialPosition() {
    if (!swimlaneScrollRef.current) return;
    if (window.innerWidth < 640) {
      // スマホでは最新の会議が見えるよう初期表示位置を右端にする
      swimlaneScrollRef.current.scrollLeft = swimlaneScrollRef.current.scrollWidth;
    } else {
      swimlaneScrollRef.current.scrollLeft = 0;
    }
  }

  useEffect(() => {
    if (hasScrolledInitially.current) return;
    if (swimlaneLoading || swimlaneData.meetings.length === 0) return;
    if (!swimlaneScrollRef.current) return;
    scrollToInitialPosition();
    hasScrolledInitially.current = true;
  }, [swimlaneLoading, swimlaneData.meetings.length]);

  // カーソル/ピンチ中心を基準にズームする。中心のワールド座標を保ったままscrollLeftを調整する
  const applyZoom = useCallback((newZoomRaw: number, clientX?: number) => {
    const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoomRaw));
    const container = swimlaneScrollRef.current;
    if (!container) {
      setZoom(newZoom);
      return;
    }
    const rect = container.getBoundingClientRect();
    const cursorX = clientX !== undefined ? clientX - rect.left : rect.width / 2;
    const contentXOld = container.scrollLeft + cursorX;
    const timelineXOld = contentXOld - LANE_LABEL_WIDTH;
    const worldX = timelineXOld / zoomRef.current;
    const timelineXNew = worldX * newZoom;
    const newScrollLeft = LANE_LABEL_WIDTH + timelineXNew - cursorX;
    setZoom(newZoom);
    requestAnimationFrame(() => {
      if (swimlaneScrollRef.current) {
        swimlaneScrollRef.current.scrollLeft = Math.max(0, newScrollLeft);
      }
    });
  }, []);

  function resetZoom() {
    setZoom(1);
    hasScrolledInitially.current = false;
    requestAnimationFrame(() => {
      scrollToInitialPosition();
      hasScrolledInitially.current = true;
    });
  }

  // ホイール(縦方向優勢)とピンチでズーム。横方向優勢なホイールは通常のスクロールに任せる
  useEffect(() => {
    const el = swimlaneScrollRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      applyZoom(zoomRef.current * factor, e.clientX);
    }

    function touchDist(touches: TouchList) {
      const [a, b] = [touches[0], touches[1]];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
    function touchMidX(touches: TouchList) {
      const [a, b] = [touches[0], touches[1]];
      return (a.clientX + b.clientX) / 2;
    }

    let pinchStartDist: number | null = null;
    let pinchStartZoom = 1;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        pinchStartDist = touchDist(e.touches);
        pinchStartZoom = zoomRef.current;
      }
    }
    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2 && pinchStartDist) {
        e.preventDefault();
        const scale = touchDist(e.touches) / pinchStartDist;
        applyZoom(pinchStartZoom * scale, touchMidX(e.touches));
      }
    }
    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) pinchStartDist = null;
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [applyZoom]);

  /* ===== LEGACY: React Flowツリー表示専用の状態(未使用、参照用に保持) =====
  const router = useRouter();
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const collapsedRef = useRef<Set<string>>(new Set());
  const meetingsRef = useRef<Meeting[]>([]);
  const globalChildMapRef = useRef<Map<string, string[]>>(new Map());
  const dragPrevPosRef = useRef<{ x: number; y: number } | null>(null);

  const handleCrossLinkClick = useCallback((cl: CrossLinkData) => {
    setSelectedCrossLink(cl);
  }, []);
  ===== LEGACY ここまで ===== */

  // ---- データ取得(リスト/人物別/テーマ別/対立/合成タブ用) ----
  async function fetchData() {
    setLoading(true);
    setFetchError("");
    try {
      const [mr, cr] = await Promise.all([
        fetch("/api/meetings?allNodes=true&limit=20"),
        fetch("/api/crosslinks"),
      ]);
      if (!mr.ok) throw new Error(`ミーティング取得エラー: ${mr.status}`);
      const md: Meeting[] = await mr.json();
      const cd: CrossLinkData[] = cr.ok ? await cr.json() : [];
      const filtered = Array.isArray(md) ? md.filter((m) => m.mindmapNodes.length > 0) : [];
      const crossLinkData = Array.isArray(cd) ? cd : [];
      setMeetings(filtered);
      setCrossLinks(crossLinkData);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "データ取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchData(); }, []);

  // ---- スイムレーンマップ用データ取得(軽量、ノード本体は含まない) ----
  async function fetchSwimlaneOverview() {
    setSwimlaneLoading(true);
    setSwimlaneError("");
    try {
      const res = await fetch("/api/map/overview");
      if (!res.ok) throw new Error(`概要取得エラー: ${res.status}`);
      const data = await res.json();
      setSwimlaneData({ meetings: data.meetings ?? [], crossLinks: data.crossLinks ?? [] });
    } catch (e) {
      setSwimlaneError(e instanceof Error ? e.message : "データ取得に失敗しました");
    } finally {
      setSwimlaneLoading(false);
    }
  }

  useEffect(() => { fetchSwimlaneOverview(); }, []);

  function toggleLane(laneId: string) {
    setHiddenLanes((prev) => {
      const next = new Set(prev);
      if (next.has(laneId)) next.delete(laneId); else next.add(laneId);
      return next;
    });
  }

  // ---- 会議ノードのクリックで展開(ルートノード+星付きノードを遅延取得) ----
  async function handleNodeClick(meetingId: string) {
    if (expandedMeetingId === meetingId) {
      setExpandedMeetingId(null);
      return;
    }
    setExpandedMeetingId(meetingId);
    if (expandedNodesCache.has(meetingId)) return;

    setExpandedLoading(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}`);
      if (res.ok) {
        const data: { mindmapNodes?: ExpandedNode[] } = await res.json();
        const filtered = (data.mindmapNodes ?? []).filter((n) => n.nodeType === "root" || n.isStarred);
        setExpandedNodesCache((prev) => new Map(prev).set(meetingId, filtered));
      }
    } finally {
      setExpandedLoading(false);
    }
  }

  const visibleSwimlaneMeetings = swimlaneData.meetings.filter((m) => {
    const laneId = swimlaneLayout.nodePositions.get(m.id)?.laneId ?? "other";
    if (hiddenLanes.has(laneId)) return false;
    if (!showClosed && isClosedTopicMeeting(m)) return false;
    return true;
  });
  const visibleSwimlaneMeetingIds = new Set(visibleSwimlaneMeetings.map((m) => m.id));

  /* ===== LEGACY: React Flowグラフ構築処理(未使用、参照用に保持) =====
  function buildGraph(
    meetingList: Meeting[],
    crossLinkList: CrossLinkData[],
    collapsedSet: Set<string>,
    onCrossLinkClick: (cl: CrossLinkData) => void,
    shouldFitView = false
  ) {
    const flowNodes: Node[] = [];
    const flowEdges: Edge[] = [];
    const nodePositions = new Map<string, { x: number; y: number }>();
    const newGlobalChildMap = new Map<string, string[]>();

    let currentY = 0;

    for (const meeting of meetingList) {
      const mNodes = meeting.mindmapNodes;
      if (mNodes.length === 0) continue;

      const childMap = new Map<string, string[]>();
      const nodeMap = new Map<string, MindmapNodeRaw>();
      let root: MindmapNodeRaw | undefined;
      for (const n of mNodes) {
        nodeMap.set(n.id, n);
        if (!n.parentId) { root = n; continue; }
        if (!childMap.has(n.parentId)) childMap.set(n.parentId, []);
        childMap.get(n.parentId)!.push(n.id);
      }
      if (!root) { currentY += NODE_HEIGHT + MEETING_GAP; continue; }

      childMap.forEach((cids, pid) => newGlobalChildMap.set(pid, cids));

      const treeH = calcSubtreeHeight(root.id, childMap, collapsedSet);
      const positions = new Map<string, { x: number; y: number }>();
      assignPositions(root.id, 0, currentY + treeH / 2, childMap, collapsedSet, positions);
      positions.forEach((pos, nid) => nodePositions.set(nid, pos));

      const visibleNodes = new Set<string>();
      const collectVisible = (id: string) => {
        const n = nodeMap.get(id);
        if (!n || !n.isVisible) return;
        visibleNodes.add(id);
        if (collapsedSet.has(id)) return;
        for (const cid of childMap.get(id) ?? []) collectVisible(cid);
      };
      collectVisible(root.id);

      for (const n of mNodes) {
        if (!n.isVisible || !visibleNodes.has(n.id)) continue;
        const pos = positions.get(n.id);
        if (!pos) continue;
        const hasChildren = (childMap.get(n.id)?.length ?? 0) > 0;
        flowNodes.push({
          id: n.id,
          type: "mindmap",
          position: pos,
          data: {
            id: n.id,
            meetingId: meeting.id,
            parentId: n.parentId,
            label: n.label,
            nodeType: n.nodeType,
            hasChildren,
            collapsed: collapsedSet.has(n.id),
            isStarred: n.isStarred,
            onToggle: (toggleId: string) => {
              const next = new Set(collapsedRef.current);
              if (next.has(toggleId)) next.delete(toggleId); else next.add(toggleId);
              collapsedRef.current = next;
              setCollapsed(new Set(next));
            },
            onHide: handleHideNode,
            onStar: handleStarNode,
          } as MindmapNodeData,
        });
      }

      currentY += treeH + MEETING_GAP;
    }

    const renderedNodeIds = new Set(flowNodes.map((n) => n.id));
    for (const cl of crossLinkList) {
      const fromOk = renderedNodeIds.has(cl.fromNodeId);
      const toOk = renderedNodeIds.has(cl.toNodeId);
      if (!fromOk || !toOk) continue;
      flowEdges.push({
        id: `cl-${cl.id}`,
        source: cl.fromNodeId,
        target: cl.toNodeId,
        type: "crossLink",
        data: { ...cl, onClick: onCrossLinkClick },
        zIndex: 10,
      });
    }

    globalChildMapRef.current = newGlobalChildMap;
    setNodes(flowNodes);
    setEdges(flowEdges);
    if (shouldFitView) setTimeout(() => fitView({ padding: 0.15 }), 50);
  }

  useEffect(() => {
    if (meetings.length === 0) return;
    buildGraph(meetings, crossLinks, collapsedRef.current, handleCrossLinkClick, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings, crossLinks]);

  useEffect(() => {
    if (meetingsRef.current.length === 0) return;
    buildGraph(meetingsRef.current, crossLinks, collapsed, handleCrossLinkClick, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  // ---- 星トグル ----
  async function handleStarNode(nodeId: string, current: boolean) {
    await fetch(`/api/mindmap/nodes/${nodeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isStarred: !current }),
    });
    meetingsRef.current = meetingsRef.current.map((m) => ({
      ...m,
      mindmapNodes: m.mindmapNodes.map((n) =>
        n.id === nodeId ? { ...n, isStarred: !current } : n
      ),
    }));
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, isStarred: !current } }
          : n
      )
    );
  }

  // ---- ノード非表示 ----
  async function handleHideNode(nodeId: string) {
    await fetch(`/api/mindmap/nodes/${nodeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isVisible: false }),
    });
    const toRemove = new Set<string>([nodeId]);
    const collect = (id: string) => {
      for (const cid of globalChildMapRef.current.get(id) ?? []) {
        toRemove.add(cid);
        collect(cid);
      }
    };
    collect(nodeId);
    setNodes((prev) => prev.filter((n) => !toRemove.has(n.id)));
    setEdges((prev) => prev.filter((e) => !toRemove.has(e.source) && !toRemove.has(e.target)));
  }

  // ---- ドラッグ追従 ----
  const onNodeDragStart = useCallback((_e: React.MouseEvent, node: Node) => {
    dragPrevPosRef.current = { x: node.position.x, y: node.position.y };
  }, []);

  const onNodeDrag = useCallback((_e: React.MouseEvent, draggedNode: Node) => {
    const prev = dragPrevPosRef.current;
    if (!prev) return;
    const dx = draggedNode.position.x - prev.x;
    const dy = draggedNode.position.y - prev.y;
    dragPrevPosRef.current = { x: draggedNode.position.x, y: draggedNode.position.y };

    const descendants = new Set<string>();
    const collect = (id: string) => {
      for (const cid of globalChildMapRef.current.get(id) ?? []) {
        descendants.add(cid);
        collect(cid);
      }
    };
    collect(draggedNode.id);
    if (descendants.size === 0) return;

    setNodes((prev) =>
      prev.map((n) =>
        descendants.has(n.id)
          ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
          : n
      )
    );
  }, [setNodes]);
  ===== LEGACY ここまで ===== */

  // ---- AI分析 ----
  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalyzeError("");
    setAnalyzeResult("");
    const res = await fetch("/api/ai/crosslinks", { method: "POST" });
    if (res.ok) {
      const d = await res.json().catch(() => ({}) as { count?: number });
      const count = (d as { count?: number }).count ?? 0;
      if (count > 0) {
        setAnalyzeResult(`${count}件の関連を検出しました(合成・共通課題・コンフリクトを含む)`);
      } else {
        setAnalyzeResult("ミーティング間の関連は見つかりませんでした。");
      }
      await fetchData();
    } else {
      const d = await res.json().catch(() => ({}));
      setAnalyzeError((d as { error?: string }).error ?? "分析に失敗しました");
    }
    setAnalyzing(false);
  }

  // ---- クロスリンク操作 ----
  async function handleAccept(cl: CrossLinkData, accepted: boolean) {
    await fetch(`/api/crosslinks/${cl.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isAccepted: accepted }),
    });
    setCrossLinks((prev) => prev.map((x) => x.id === cl.id ? { ...x, isAccepted: accepted } : x));
    if (selectedCrossLink?.id === cl.id) setSelectedCrossLink({ ...cl, isAccepted: accepted });
  }

  async function handleDeleteCrossLink(cl: CrossLinkData) {
    await fetch(`/api/crosslinks/${cl.id}`, { method: "DELETE" });
    setCrossLinks((prev) => prev.filter((x) => x.id !== cl.id));
    setSelectedCrossLink(null);
  }

  const pendingCount = crossLinks.filter((cl) => cl.isAccepted === null).length;
  const acceptedCount = crossLinks.filter((cl) => cl.isAccepted === true).length;

  return (
    <div className="h-viewport" style={{ display: "flex", flexDirection: "column", background: "#f9fafb" }}>
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-100 px-4 py-3 z-10 flex-shrink-0">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-xl">←</Link>
          <h1 className="text-base font-bold text-gray-800 flex-1">全体マップ</h1>
          <div className="flex items-center gap-2">
            {crossLinks.length > 0 && pendingCount > 0 && (
              <span className="text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full font-medium">
                {pendingCount}件提案中
              </span>
            )}
            <button onClick={handleAnalyze} disabled={analyzing}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-100 hover:bg-indigo-200 text-indigo-700 transition-colors disabled:opacity-50 font-medium whitespace-nowrap">
              {analyzing ? "分析中..." : "AI分析"}
            </button>
          </div>
        </div>
        {analyzeError && <p className="text-xs text-red-500 text-center mt-1">{analyzeError}</p>}
        {analyzeResult && <p className="text-xs text-indigo-600 text-center mt-1">{analyzeResult}</p>}
      </header>

      {/* タブバー */}
      <div className="bg-white border-b border-gray-100 flex-shrink-0 overflow-x-auto">
        <div className="flex min-w-max px-4">
          {([
            { key: "map",       label: "🗺️ マップ" },
            { key: "list",      label: "🔗 リスト" },
            { key: "person",    label: "👤 人物別" },
            { key: "theme",     label: "🏷️ テーマ別" },
            { key: "conflict",  label: "⚡ 対立" },
            { key: "synthesis", label: `✨ 合成${acceptedCount > 0 ? `(${acceptedCount})` : ""}` },
          ] as const).map((t) => (
            <button key={t.key} onClick={() => setView(t.key)}
              className={`py-2.5 px-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                view === t.key ? "border-indigo-500 text-indigo-600" : "border-transparent text-gray-400 hover:text-gray-600"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {fetchError && view !== "map" && (
        <p className="text-xs text-red-500 text-center py-1 bg-red-50 flex-shrink-0">{fetchError}</p>
      )}

      {/* スイムレーンマップ */}
      {view === "map" && (
        <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {(swimlaneLoading || swimlaneError || swimlaneData.meetings.length === 0) ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              {swimlaneLoading && <p className="text-gray-400 text-sm">読み込み中...</p>}
              {!swimlaneLoading && swimlaneError && (
                <>
                  <p className="text-red-500 text-sm">{swimlaneError}</p>
                  <button onClick={fetchSwimlaneOverview} className="text-indigo-600 text-sm">再試行</button>
                </>
              )}
              {!swimlaneLoading && !swimlaneError && swimlaneData.meetings.length === 0 && (
                <>
                  <p className="text-gray-400 text-sm">分析済みのミーティングがありません</p>
                  <Link href="/meetings/new" className="text-indigo-600 text-sm">ミーティングを始める</Link>
                </>
              )}
            </div>
          ) : (
            <>
              {/* フィルター */}
              <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-gray-100 bg-white flex-shrink-0">
                {ALL_LANES.map((lane) => (
                  <button key={lane.id} onClick={() => toggleLane(lane.id)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      hiddenLanes.has(lane.id)
                        ? "bg-gray-50 text-gray-300 border-gray-100"
                        : "bg-indigo-50 text-indigo-600 border-indigo-100"
                    }`}>
                    {lane.label}
                  </button>
                ))}
                <label className="flex items-center gap-1.5 text-xs text-gray-500 ml-1">
                  <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
                  終了した話題を表示
                </label>
              </div>

              {/* スイムレーン本体(1つのスクロールコンテナ内でヘッダー行/ラベル列をsticky) */}
              <div
                ref={swimlaneScrollRef}
                className="flex-1 relative"
                style={{ overflow: "auto", WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y" }}
              >
                <div style={{ width: LANE_LABEL_WIDTH + swimlaneLayout.width, position: "relative" }}>
                  {/* 月の目盛り(sticky top) */}
                  <div style={{ position: "sticky", top: 0, zIndex: 20, display: "flex", height: MONTH_HEADER_HEIGHT }}>
                    <div style={{ position: "sticky", left: 0, width: LANE_LABEL_WIDTH, flexShrink: 0, zIndex: 22 }}
                      className="bg-white border-b border-r border-gray-100" />
                    <div style={{ position: "relative", flex: 1 }} className="bg-white border-b border-gray-100">
                      {swimlaneLayout.months.map((mo, i) => (
                        <div key={mo.key}
                          style={{ position: "absolute", left: swimlaneLayout.padding + i * swimlaneLayout.monthWidth + 6, top: 0, height: "100%" }}
                          className="flex items-center text-[11px] font-medium text-gray-500 whitespace-nowrap">
                          {mo.month}月{mo.showYear ? `(${mo.year})` : ""}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* レーンラベル(sticky left) + タイムライン本体 */}
                  <div style={{ display: "flex" }}>
                    <div style={{ position: "sticky", left: 0, zIndex: 15, width: LANE_LABEL_WIDTH, flexShrink: 0 }}
                      className="border-r border-gray-100">
                      {ALL_LANES.map((lane) => (
                        <div key={lane.id} style={{ height: swimlaneLayout.laneHeight, background: lane.bgColor }}
                          className="flex items-center px-2 text-xs font-medium text-gray-600 border-b border-white/60">
                          {lane.label}
                        </div>
                      ))}
                    </div>

                    <div style={{ position: "relative", width: swimlaneLayout.width, height: swimlaneLayout.totalHeight }}>
                      {/* レーン背景色 */}
                      {ALL_LANES.map((lane, i) => (
                        <div key={lane.id}
                          style={{ position: "absolute", top: i * swimlaneLayout.laneHeight, left: 0, right: 0, height: swimlaneLayout.laneHeight, background: lane.bgColor }} />
                      ))}
                      {/* レーン区切り線 */}
                      {ALL_LANES.map((lane, i) => (
                        <div key={`sep-${lane.id}`}
                          style={{ position: "absolute", top: (i + 1) * swimlaneLayout.laneHeight - 1, left: 0, right: 0, height: 1 }}
                          className="bg-white" />
                      ))}
                      {/* 月の区切り縦線 */}
                      {[...swimlaneLayout.months.map((_, i) => i), swimlaneLayout.months.length].map((i) => (
                        <div key={`month-line-${i}`}
                          style={{ position: "absolute", left: swimlaneLayout.padding + i * swimlaneLayout.monthWidth, top: 0, bottom: 0, width: 1 }}
                          className="bg-gray-200" />
                      ))}

                      {/* クロスリンク */}
                      <svg
                        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
                        width={swimlaneLayout.width}
                        height={swimlaneLayout.totalHeight}
                      >
                        {swimlaneData.crossLinks
                          .filter((cl) => visibleSwimlaneMeetingIds.has(cl.fromMeetingId) && visibleSwimlaneMeetingIds.has(cl.toMeetingId))
                          .map((cl) => {
                            const from = swimlaneLayout.nodePositions.get(cl.fromMeetingId);
                            const to = swimlaneLayout.nodePositions.get(cl.toMeetingId);
                            if (!from || !to) return null;
                            const count = cl.sharedTags.length || 1;
                            const strokeWidth = count >= 3 ? 4 : count === 2 ? 2.5 : 1.5;
                            const opacity = count >= 3 ? 0.8 : count === 2 ? 0.5 : 0.3;
                            const sameLane = from.laneId === to.laneId;
                            const d = sameLane
                              ? `M ${from.x} ${from.y} L ${to.x} ${to.y}`
                              : `M ${from.x} ${from.y} C ${from.x} ${(from.y + to.y) / 2}, ${to.x} ${(from.y + to.y) / 2}, ${to.x} ${to.y}`;
                            return (
                              <path key={cl.id} d={d} fill="none" stroke="#6366f1"
                                strokeWidth={strokeWidth} opacity={opacity} style={{ pointerEvents: "stroke" }}>
                                <title>{cl.sharedTags.join("、")}</title>
                              </path>
                            );
                          })}
                      </svg>

                      {/* 会議ノード */}
                      {visibleSwimlaneMeetings.map((m) => {
                        const pos = swimlaneLayout.nodePositions.get(m.id);
                        if (!pos) return null;
                        const isFront = m.id === hoveredMeetingId || m.id === expandedMeetingId;
                        return (
                          <div key={m.id}
                            onClick={() => handleNodeClick(m.id)}
                            onMouseEnter={() => setHoveredMeetingId(m.id)}
                            onMouseLeave={() => setHoveredMeetingId(null)}
                            onTouchStart={() => setHoveredMeetingId(m.id)}
                            style={{
                              position: "absolute",
                              left: pos.x - SWIMLANE_NODE_WIDTH / 2,
                              top: pos.y,
                              width: SWIMLANE_NODE_WIDTH,
                              zIndex: isFront ? 40 : 10,
                            }}
                            className="bg-white border border-indigo-200 rounded-lg shadow-sm px-1.5 py-1 cursor-pointer hover:border-indigo-400 hover:shadow-md transition-shadow">
                            <p className="text-xs font-medium text-gray-800 leading-tight"
                              style={{
                                display: "-webkit-box",
                                WebkitLineClamp: zoom >= ZOOM_SEMANTIC_THRESHOLD ? NODE_TITLE_LINES_FULL : 1,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                              }}>
                              {m.title ?? "タイトルなし"}
                            </p>
                            <div className="flex items-center justify-between mt-0.5">
                              <span className="text-[10px] text-gray-400">
                                {new Date(m.date).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                              </span>
                              <span className="text-[10px] bg-indigo-50 text-indigo-500 px-1 rounded flex-shrink-0">{m.nodeCount}</span>
                            </div>
                          </div>
                        );
                      })}

                      {/* クリックで展開するポップオーバー */}
                      {expandedMeetingId && (() => {
                        const pos = swimlaneLayout.nodePositions.get(expandedMeetingId);
                        if (!pos) return null;
                        const nodesForPopover = expandedNodesCache.get(expandedMeetingId) ?? [];
                        return (
                          <div
                            style={{ position: "absolute", left: pos.x - SWIMLANE_NODE_WIDTH / 2, top: pos.y + 36, width: 220, zIndex: 50 }}
                            className="bg-white rounded-xl shadow-lg border border-gray-100 p-3">
                            {expandedLoading ? (
                              <p className="text-xs text-gray-400">読み込み中...</p>
                            ) : (
                              <>
                                <ul className="space-y-1 text-xs text-gray-700 max-h-40 overflow-y-auto">
                                  {nodesForPopover.map((n) => (
                                    <li key={n.id} className="flex items-center gap-1">
                                      <span>{n.nodeType === "root" ? "🏠" : "⭐"}</span>
                                      <span className="truncate">{n.label}</span>
                                    </li>
                                  ))}
                                </ul>
                                <Link href={`/meetings/${expandedMeetingId}/result`} className="text-indigo-600 text-xs underline mt-2 inline-block">
                                  詳細を見る →
                                </Link>
                              </>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              {/* ズームUI: マップ上に浮かせるだけのオーバーレイ。レーンの高さ計算には一切関与しない */}
              <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-0.5 bg-white/70 backdrop-blur-sm rounded-xl shadow-md border border-gray-100 p-1 pointer-events-auto">
                <button onClick={() => applyZoom(zoomRef.current + 0.25)}
                  className="w-7 h-7 flex items-center justify-center text-gray-600 hover:bg-gray-100/80 rounded-lg text-sm font-medium">
                  ＋
                </button>
                <button onClick={() => applyZoom(zoomRef.current - 0.25)}
                  className="w-7 h-7 flex items-center justify-center text-gray-600 hover:bg-gray-100/80 rounded-lg text-sm font-medium">
                  −
                </button>
                <button onClick={resetZoom}
                  className="w-7 h-7 flex items-center justify-center text-gray-400 hover:bg-gray-100/80 rounded-lg text-[9px] font-medium">
                  リセット
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ===== LEGACY: React Flowツリー表示(参照用に保持、未使用) =====
      {view === "map" && (
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {(loading || fetchError || meetings.length === 0) && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, zIndex: 5, background: "#f9fafb" }}>
              {loading && <p style={{ color: "#9ca3af", fontSize: 14 }}>読み込み中...</p>}
              {!loading && fetchError && <>
                <p style={{ color: "#ef4444", fontSize: 14 }}>{fetchError}</p>
                <button onClick={fetchData} style={{ color: "#6366f1", fontSize: 14 }}>再試行</button>
              </>}
              {!loading && !fetchError && meetings.length === 0 && <>
                <p style={{ color: "#9ca3af", fontSize: 14 }}>分析済みのミーティングがありません</p>
                <Link href="/meetings/new" style={{ color: "#6366f1", fontSize: 14 }}>ミーティングを始める</Link>
              </>}
            </div>
          )}
          <div style={{ position: "absolute", inset: 0, visibility: (loading || fetchError || meetings.length === 0) ? "hidden" : "visible" }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeDragStart={onNodeDragStart}
              onNodeDrag={onNodeDrag}
              onNodeDoubleClick={(_, node) => {
                if (node.data?.nodeType === "root") {
                  router.push(`/meetings/${node.data.meetingId as string}/result`);
                }
              }}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.1}
              maxZoom={2}
            >
              <Background color="#e5e7eb" gap={24} />
              <Controls />
              <MiniMap
                nodeColor={(n) => NODE_COLORS[n.data?.nodeType as string] ?? "#a5b4fc"}
                maskColor="rgba(240,240,245,0.7)"
                style={{ bottom: 80, right: 16 }}
              />
            </ReactFlow>
          </div>

          {selectedCrossLink && (
            <div className="absolute bottom-20 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 bg-white rounded-2xl shadow-xl border border-gray-100 p-4 z-20">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: selectedCrossLink.categoryColor }} />
                  <span className="text-xs font-semibold text-gray-600">{selectedCrossLink.category ?? "関連"}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    selectedCrossLink.strength === "strong" ? "bg-indigo-100 text-indigo-700" :
                    selectedCrossLink.strength === "medium" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                  }`}>
                    {selectedCrossLink.strength === "strong" ? "強い関連" : selectedCrossLink.strength === "medium" ? "中程度" : "弱い関連"}
                  </span>
                </div>
                <button onClick={() => setSelectedCrossLink(null)} className="text-gray-300 hover:text-gray-500">✕</button>
              </div>
              <div className="flex items-center gap-2 mb-3 text-xs text-gray-500 bg-gray-50 rounded-xl p-2">
                <span className="truncate font-medium text-gray-700">{selectedCrossLink.fromNode.label}</span>
                <span className="flex-shrink-0">↔</span>
                <span className="truncate font-medium text-gray-700">{selectedCrossLink.toNode.label}</span>
              </div>
              {selectedCrossLink.reason && (
                <div className="mb-2">
                  <p className="text-xs font-semibold text-gray-500 mb-1">関連理由</p>
                  <p className="text-xs text-gray-700 leading-relaxed">{selectedCrossLink.reason}</p>
                </div>
              )}
              {selectedCrossLink.newValueSuggestion && (
                <div className="mb-3 bg-indigo-50 rounded-xl p-2.5">
                  <p className="text-xs font-semibold text-indigo-600 mb-1">組み合わせると…</p>
                  <p className="text-xs text-indigo-800 leading-relaxed">{selectedCrossLink.newValueSuggestion}</p>
                </div>
              )}
              <div className="flex gap-2">
                {selectedCrossLink.isAccepted !== true && (
                  <button onClick={() => handleAccept(selectedCrossLink, true)}
                    className="flex-1 py-2 bg-green-500 hover:bg-green-600 text-white text-xs font-medium rounded-lg transition-colors">承認</button>
                )}
                {selectedCrossLink.isAccepted !== false && (
                  <button onClick={() => handleAccept(selectedCrossLink, false)}
                    className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium rounded-lg transition-colors">却下</button>
                )}
                <button onClick={() => handleDeleteCrossLink(selectedCrossLink)}
                  className="py-2 px-3 bg-red-50 hover:bg-red-100 text-red-500 text-xs font-medium rounded-lg transition-colors">削除</button>
              </div>
            </div>
          )}
        </div>
      )}
      ===== LEGACY ここまで ===== */}

      {/* リストビュー */}
      {view === "list" && (
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>
          <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
            {loading ? (
              <div className="text-center text-gray-400 text-sm py-12">読み込み中...</div>
            ) : crossLinks.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
                <p className="text-gray-400 text-sm">クロスリンクがまだありません</p>
                <p className="text-gray-400 text-xs mt-1">「クロスリンクを分析」を押してAIに分析させてください</p>
              </div>
            ) : (
              crossLinks.map((cl) => (
                <div key={cl.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: cl.categoryColor }} />
                    <span className="text-xs font-semibold text-gray-600">{cl.category ?? "関連"}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      cl.strength === "strong" ? "bg-indigo-100 text-indigo-700" :
                      cl.strength === "medium" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                    }`}>
                      {cl.strength === "strong" ? "強い" : cl.strength === "medium" ? "中程度" : "弱い"}
                    </span>
                    {cl.isAccepted === true && <span className="ml-auto text-xs text-green-600 font-medium">承認済み</span>}
                    {cl.isAccepted === null && <span className="ml-auto text-xs text-amber-600 font-medium">提案中</span>}
                  </div>
                  <div className="flex items-start gap-2 text-xs bg-gray-50 rounded-xl p-2">
                    <div className="flex-1">
                      <p className="text-gray-400">会議A</p>
                      <p className="font-medium text-gray-800 mt-0.5">{cl.fromNode.label}</p>
                    </div>
                    <span className="text-gray-300 mt-4">↔</span>
                    <div className="flex-1 text-right">
                      <p className="text-gray-400">会議B</p>
                      <p className="font-medium text-gray-800 mt-0.5">{cl.toNode.label}</p>
                    </div>
                  </div>
                  {cl.reason && <p className="text-xs text-gray-600 leading-relaxed">{cl.reason}</p>}
                  {cl.newValueSuggestion && (
                    <div className="bg-indigo-50 rounded-xl p-2.5">
                      <p className="text-xs font-semibold text-indigo-600 mb-1">組み合わせると…</p>
                      <p className="text-xs text-indigo-800 leading-relaxed">{cl.newValueSuggestion}</p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    {cl.isAccepted !== true && (
                      <button onClick={() => handleAccept(cl, true)}
                        className="flex-1 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 text-xs font-medium rounded-lg transition-colors">承認</button>
                    )}
                    {cl.isAccepted !== false && (
                      <button onClick={() => handleAccept(cl, false)}
                        className="flex-1 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium rounded-lg transition-colors">却下</button>
                    )}
                    <button onClick={() => handleDeleteCrossLink(cl)}
                      className="py-1.5 px-3 bg-red-50 hover:bg-red-100 text-red-400 text-xs rounded-lg transition-colors">削除</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 人物別ビュー */}
      {view === "person" && (
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>
          <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
            {loading ? (
              <p className="text-center text-gray-400 text-sm py-12">読み込み中...</p>
            ) : (() => {
              const personMap = new Map<string, { name: string; org: string | null; meetings: Meeting[] }>();
              for (const m of meetings) {
                for (const mc of m.meetingContacts ?? []) {
                  const c = mc.contact;
                  if (!personMap.has(c.id)) personMap.set(c.id, { name: c.name, org: c.organization, meetings: [] });
                  personMap.get(c.id)!.meetings.push(m);
                }
              }
              const persons = Array.from(personMap.values()).sort((a, b) => b.meetings.length - a.meetings.length);
              if (persons.length === 0) return (
                <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
                  <p className="text-gray-400 text-sm">参加者が設定されたミーティングがありません</p>
                </div>
              );
              return persons.map((p) => {
                const allTopics = p.meetings.flatMap((m) =>
                  m.mindmapNodes.filter((n) => n.nodeType === "topic").map((n) => n.label)
                );
                const uniqueTopics = Array.from(new Set(allTopics)).slice(0, 6);
                const lastDate = p.meetings[0]?.date;
                return (
                  <div key={p.name} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm flex-shrink-0">
                        {p.name[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-800 text-sm">{p.name}</p>
                          {p.org && <p className="text-xs text-gray-400 truncate">{p.org}</p>}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {p.meetings.length}回の会議 · 最終 {lastDate ? new Date(lastDate).toLocaleDateString("ja-JP") : "不明"}
                        </p>
                        {uniqueTopics.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {uniqueTopics.map((t) => (
                              <span key={t} className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* テーマ別ビュー */}
      {view === "theme" && (
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>
          <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
            {loading ? (
              <p className="text-center text-gray-400 text-sm py-12">読み込み中...</p>
            ) : crossLinks.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
                <p className="text-gray-400 text-sm">「AI分析」を実行するとテーマ別に関連が表示されます</p>
              </div>
            ) : (() => {
              const themeMap = new Map<string, CrossLinkData[]>();
              for (const cl of crossLinks) {
                const cat = cl.category ?? "その他";
                if (!themeMap.has(cat)) themeMap.set(cat, []);
                themeMap.get(cat)!.push(cl);
              }
              return Array.from(themeMap.entries()).map(([cat, links]) => (
                <div key={cat} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: links[0]?.categoryColor ?? "#6366f1" }} />
                    <p className="text-sm font-semibold text-gray-700">{cat}</p>
                    <span className="ml-auto text-xs text-gray-400">{links.length}件</span>
                  </div>
                  <div className="space-y-2">
                    {links.map((cl) => (
                      <div key={cl.id} className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-600">
                        <span className="font-medium text-gray-800">{cl.fromNode.label}</span>
                        <span className="mx-1.5 text-gray-300">↔</span>
                        <span className="font-medium text-gray-800">{cl.toNode.label}</span>
                        {cl.reason && <p className="mt-1 text-gray-500">{cl.reason}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* コンフリクトビュー */}
      {view === "conflict" && (
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>
          <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
            {loading ? (
              <p className="text-center text-gray-400 text-sm py-12">読み込み中...</p>
            ) : (() => {
              const conflicts = crossLinks.filter((cl) => cl.category?.startsWith("[コンフリクト]"));
              if (conflicts.length === 0) return (
                <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
                  <p className="text-gray-400 text-sm">コンフリクトは検出されていません</p>
                  <p className="text-gray-400 text-xs mt-1">「AI分析」を実行すると矛盾・衝突する決定を検出します</p>
                </div>
              );
              return conflicts.map((cl) => (
                <div key={cl.id} className="bg-white rounded-2xl border border-red-100 shadow-sm p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-red-500 text-sm">⚡</span>
                    <p className="text-xs font-semibold text-red-600">{cl.category?.replace("[コンフリクト] ", "") ?? "コンフリクト"}</p>
                    <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${cl.strength === "strong" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-600"}`}>
                      {cl.strength === "strong" ? "重大" : "要確認"}
                    </span>
                  </div>
                  <div className="bg-red-50 rounded-xl px-3 py-2 mb-2 flex items-center gap-2 text-xs">
                    <span className="font-medium text-gray-800 flex-1">{cl.fromNode.label}</span>
                    <span className="text-red-400 flex-shrink-0">vs</span>
                    <span className="font-medium text-gray-800 flex-1 text-right">{cl.toNode.label}</span>
                  </div>
                  {cl.reason && <p className="text-xs text-gray-600 leading-relaxed">{cl.reason}</p>}
                  {cl.newValueSuggestion && (
                    <p className="text-xs text-red-600 mt-1.5 leading-relaxed">{cl.newValueSuggestion}</p>
                  )}
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* 合成チャンスビュー */}
      {view === "synthesis" && (
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>
          <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
            {loading ? (
              <p className="text-center text-gray-400 text-sm py-12">読み込み中...</p>
            ) : (() => {
              const syntheses = crossLinks.filter((cl) => cl.category?.startsWith("[合成]"));
              const commonIssues = crossLinks.filter((cl) => cl.category?.startsWith("[共通課題]"));
              if (syntheses.length === 0 && commonIssues.length === 0) return (
                <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
                  <p className="text-gray-400 text-sm">合成チャンス・共通課題は検出されていません</p>
                  <p className="text-gray-400 text-xs mt-1">「AI分析」を実行すると組み合わせると面白い企画や共通課題を検出します</p>
                </div>
              );
              return (
                <>
                  {syntheses.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-gray-400 mb-2 px-1">合成チャンス({syntheses.length}件)</h3>
                      <div className="space-y-3">
                        {syntheses.map((cl) => (
                          <div key={cl.id} className="bg-white rounded-2xl border border-indigo-100 shadow-sm p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-indigo-500">✨</span>
                              <p className="text-xs font-semibold text-indigo-600">{cl.category?.replace("[合成] ", "") ?? "合成"}</p>
                              <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600`}>
                                {cl.strength === "strong" ? "強い可能性" : "検討余地あり"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 bg-indigo-50 rounded-xl px-3 py-2 mb-2 text-xs">
                              <span className="font-medium text-gray-800 flex-1">{cl.fromNode.label}</span>
                              <span className="text-indigo-400 flex-shrink-0">+</span>
                              <span className="font-medium text-gray-800 flex-1 text-right">{cl.toNode.label}</span>
                            </div>
                            {cl.newValueSuggestion && (
                              <p className="text-xs text-indigo-800 leading-relaxed">{cl.newValueSuggestion}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {commonIssues.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-gray-400 mb-2 px-1">共通課題({commonIssues.length}件)</h3>
                      <div className="space-y-3">
                        {commonIssues.map((cl) => (
                          <div key={cl.id} className="bg-white rounded-2xl border border-green-100 shadow-sm p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-green-500">🔗</span>
                              <p className="text-xs font-semibold text-green-600">{cl.category?.replace("[共通課題] ", "") ?? "共通課題"}</p>
                            </div>
                            <div className="flex items-center gap-2 bg-green-50 rounded-xl px-3 py-2 mb-2 text-xs">
                              <span className="font-medium text-gray-800 flex-1">{cl.fromNode.label}</span>
                              <span className="text-green-400 flex-shrink-0">≈</span>
                              <span className="font-medium text-gray-800 flex-1 text-right">{cl.toNode.label}</span>
                            </div>
                            {cl.reason && <p className="text-xs text-gray-600 leading-relaxed">{cl.reason}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MapPage() {
  return <MapInner />;
}
