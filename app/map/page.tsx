"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactFlow, {
  Node, Edge,
  Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  EdgeProps, getBezierPath, useReactFlow,
  ReactFlowProvider,
} from "reactflow";

// ---- 型定義 ----
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
}

// ---- 定数 ----
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

      {/* 星ボタン：星あり→常時表示、星なし→ホバー時表示 */}
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

      {/* 非表示ボタン（root以外、ホバー時にノード内右端に表示） */}
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

// ---- メインコンポーネント ----
function MapInner() {
  const router = useRouter();
  const { fitView } = useReactFlow();

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [crossLinks, setCrossLinks] = useState<CrossLinkData[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [analyzeResult, setAnalyzeResult] = useState("");
  const [view, setView] = useState<"map" | "list">("map");
  const [selectedCrossLink, setSelectedCrossLink] = useState<CrossLinkData | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const collapsedRef = useRef<Set<string>>(new Set());
  // meetings の最新値を ref でも保持（星更新時に setMeetings を避けるため）
  const meetingsRef = useRef<Meeting[]>([]);
  // 全ノードの親子マップ（ドラッグ追従用）
  const globalChildMapRef = useRef<Map<string, string[]>>(new Map());
  // ドラッグ中の直前位置
  const dragPrevPosRef = useRef<{ x: number; y: number } | null>(null);

  const handleCrossLinkClick = useCallback((cl: CrossLinkData) => {
    setSelectedCrossLink(cl);
  }, []);

  // ---- データ取得 ----
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
      console.log(`[fetchData] meetings: ${filtered.length}, crossLinks: ${crossLinkData.length}`);
      meetingsRef.current = filtered;
      setMeetings(filtered);
      setCrossLinks(crossLinkData);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "データ取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchData(); }, []);

  // ---- グラフ構築 ----
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

      // 全ノードで親子マップとIDマップを構築（isVisibleに関係なく全て）
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

      // グローバル親子マップに統合
      childMap.forEach((cids, pid) => newGlobalChildMap.set(pid, cids));

      const treeH = calcSubtreeHeight(root.id, childMap, collapsedSet);
      const positions = new Map<string, { x: number; y: number }>();
      assignPositions(root.id, 0, currentY + treeH / 2, childMap, collapsedSet, positions);
      positions.forEach((pos, nid) => nodePositions.set(nid, pos));

      // 可視ノード収集（isVisible=falseは自身+子孫をスキップ）
      const visibleNodes = new Set<string>();
      const collectVisible = (id: string) => {
        const n = nodeMap.get(id);
        if (!n || !n.isVisible) return;
        visibleNodes.add(id);
        if (collapsedSet.has(id)) return;
        for (const cid of childMap.get(id) ?? []) collectVisible(cid);
      };
      collectVisible(root.id);

      // フローノード生成（エッジなし = 線なし）
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

    // クロスリンクエッジ（両ノードが表示されている場合のみ）
    const renderedNodeIds = new Set(flowNodes.map((n) => n.id));
    console.log(`[buildGraph] flowNodes: ${flowNodes.length}, crossLinks: ${crossLinkList.length}, renderedNodeIds: ${renderedNodeIds.size}`);
    for (const cl of crossLinkList) {
      const fromOk = renderedNodeIds.has(cl.fromNodeId);
      const toOk = renderedNodeIds.has(cl.toNodeId);
      console.log(`[buildGraph] crosslink ${cl.id}: from=${cl.fromNodeId}(${fromOk}) to=${cl.toNodeId}(${toOk})`);
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
    console.log(`[buildGraph] flowEdges (crosslinks): ${flowEdges.length}`);

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

  // 折りたたみ変更時は現在位置を維持（fitViewしない、refを使う）
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
    // refを更新（setMeetingsを使うとfitViewが走るため回避）
    meetingsRef.current = meetingsRef.current.map((m) => ({
      ...m,
      mindmapNodes: m.mindmapNodes.map((n) =>
        n.id === nodeId ? { ...n, isStarred: !current } : n
      ),
    }));
    // React Flowのノードデータだけ直接更新（現在の表示位置を維持）
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
    // 子孫ノードも含めて即時除去
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

    // 子孫を収集して同じだけ移動
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
        setAnalyzeResult(`${count}件の関連を検出しました`);
      } else {
        setAnalyzeResult("共通キーワードが見つかりませんでした。ノードのラベルに共通する単語が含まれているか確認してください。");
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
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#f9fafb" }}>
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-100 px-4 py-3 z-10 flex-shrink-0">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-xl">←</Link>
          <h1 className="text-base font-bold text-gray-800 flex-1">全体マップ</h1>
          <div className="flex items-center gap-2">
            {crossLinks.length > 0 && (
              <div className="flex items-center gap-1 text-xs text-gray-400">
                <span className="text-indigo-600 font-medium">{acceptedCount}</span>承認
                {pendingCount > 0 && (
                  <span className="ml-1 bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full font-medium">
                    {pendingCount}件提案中
                  </span>
                )}
              </div>
            )}
            <div className="flex border border-gray-200 rounded-lg overflow-hidden">
              <button onClick={() => setView("map")}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === "map" ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-50"}`}>
                マップ
              </button>
              <button onClick={() => setView("list")}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === "list" ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-50"}`}>
                リスト
              </button>
            </div>
            <button onClick={handleAnalyze} disabled={analyzing}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-100 hover:bg-indigo-200 text-indigo-700 transition-colors disabled:opacity-50 font-medium">
              {analyzing ? "分析中..." : "クロスリンクを分析"}
            </button>
          </div>
        </div>
        {analyzeError && <p className="text-xs text-red-500 text-center mt-1">{analyzeError}</p>}
        {analyzeResult && <p className="text-xs text-indigo-600 text-center mt-1">{analyzeResult}</p>}
      </header>

      {/* コンテンツ */}
      {view === "map" ? (
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {/* ローディング・エラー・空状態（ReactFlowはアンマウントせずCSSで隠す） */}
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
          {/* ReactFlowは常にマウント（再マウントでedgeTypesがリセットされないよう） */}
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
          )}

          {/* クロスリンク詳細パネル */}
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
      ) : (
        /* リストビュー */
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
    </div>
  );
}

export default function MapPage() {
  return (
    <ReactFlowProvider>
      <MapInner />
    </ReactFlowProvider>
  );
}
