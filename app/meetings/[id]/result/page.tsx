"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ReactFlow, {
  Node, Edge, Background, Controls,
  useNodesState, useEdgesState, MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";
import { NODE_STATUS_OPTIONS, STATUS_COLORS, type NodeStatus } from "@/types";
import Toast, { type ToastType } from "@/app/components/Toast";

interface MindmapNode {
  id: string;
  parentId: string | null;
  label: string;
  nodeType: string;
  status: string | null;
  isVisible: boolean;
  isSecret: boolean;
  isStarred: boolean;
  positionX: number;
  positionY: number;
}

interface Contact {
  id: string;
  name: string;
  organization: string | null;
}

interface ContactRef {
  id: string;
  name: string;
  organization: string | null;
}

interface Meeting {
  id: string;
  title: string | null;
  transcript: string | null;
  status: string;
  date: string;
  contact: ContactRef | null;
  meetingContacts: { contact: ContactRef }[];
  mindmapNodes: MindmapNode[];
}

const NODE_COLORS: Record<string, string> = {
  root: "#4338ca",
  topic: "#6366f1",
  item: "#a5b4fc",
  action: "#f59e0b",
};

const NODE_HEIGHT = 50;
const NODE_GAP = 20;
const LEVEL_WIDTH = 260;

function calcSubtreeHeight(id: string, childMap: Map<string, MindmapNode[]>): number {
  const children = childMap.get(id) ?? [];
  if (children.length === 0) return NODE_HEIGHT;
  const childTotal = children.reduce((sum, c) => sum + calcSubtreeHeight(c.id, childMap), 0);
  return Math.max(NODE_HEIGHT, childTotal + (children.length - 1) * NODE_GAP);
}

function assignPositions(
  id: string, x: number, centerY: number,
  childMap: Map<string, MindmapNode[]>,
  positions: Map<string, { x: number; y: number }>
) {
  positions.set(id, { x, y: centerY - NODE_HEIGHT / 2 });
  const children = childMap.get(id) ?? [];
  if (children.length === 0) return;
  const totalH = children.reduce((sum, c) => sum + calcSubtreeHeight(c.id, childMap), 0)
    + (children.length - 1) * NODE_GAP;
  let curY = centerY - totalH / 2;
  for (const child of children) {
    const h = calcSubtreeHeight(child.id, childMap);
    assignPositions(child.id, x + LEVEL_WIDTH, curY + h / 2, childMap, positions);
    curY += h + NODE_GAP;
  }
}

function buildFlowElements(nodes: MindmapNode[]): { flowNodes: Node[]; flowEdges: Edge[] } {
  const childMap = new Map<string, MindmapNode[]>();
  let root: MindmapNode | undefined;
  for (const n of nodes) {
    if (!n.parentId) { root = n; continue; }
    if (!childMap.has(n.parentId)) childMap.set(n.parentId, []);
    childMap.get(n.parentId)!.push(n);
  }
  const positions = new Map<string, { x: number; y: number }>();
  if (root) assignPositions(root.id, 0, 0, childMap, positions);

  const flowNodes: Node[] = nodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      position: pos,
      data: { label: n.label },
      style: {
        background: NODE_COLORS[n.nodeType] ?? "#6366f1",
        color: n.nodeType === "item" ? "#1e1b4b" : "white",
        border: n.isStarred ? "2.5px solid #f59e0b" : "none",
        borderRadius: 12,
        padding: "8px 14px",
        fontSize: 13,
        fontWeight: n.nodeType === "root" ? "bold" : "normal",
        opacity: n.isVisible ? 1 : 0.35,
        minWidth: 120,
        maxWidth: 220,
        boxShadow: n.isStarred ? "0 0 8px rgba(245,158,11,0.5)" : undefined,
      },
    };
  });

  const flowEdges: Edge[] = nodes
    .filter((n) => n.parentId)
    .map((n) => ({
      id: `e-${n.parentId}-${n.id}`,
      source: n.parentId!,
      target: n.id,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#a5b4fc" },
      style: { stroke: "#a5b4fc", strokeWidth: 1.5 },
    }));

  return { flowNodes, flowEdges };
}

function exportAsText(nodes: MindmapNode[]): string {
  const childMap = new Map<string, MindmapNode[]>();
  let root: MindmapNode | undefined;
  for (const n of nodes) {
    if (!n.parentId) { root = n; continue; }
    if (!childMap.has(n.parentId)) childMap.set(n.parentId, []);
    childMap.get(n.parentId)!.push(n);
  }
  const lines: string[] = [];
  function walk(id: string, depth: number) {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    const indent = "  ".repeat(depth);
    const prefix = depth === 0 ? "# " : depth === 1 ? "## " : "- ";
    const status = n.status ? ` [${n.status}]` : "";
    lines.push(`${indent}${prefix}${n.label}${status}`);
    for (const child of childMap.get(id) ?? []) {
      walk(child.id, depth + 1);
    }
  }
  if (root) walk(root.id, 0);
  return lines.join("\n");
}

export default function ResultPage() {
  const { id } = useParams<{ id: string }>();
  const autoAnalyze = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("autoAnalyze") === "1";
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [rawNodes, setRawNodes] = useState<MindmapNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<MindmapNode | null>(null);
  const [tab, setTab] = useState<"map" | "transcript">("map");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingDate, setEditingDate] = useState(false);
  const [dateDraft, setDateDraft] = useState("");
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [showContactModal, setShowContactModal] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactQuery, setContactQuery] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const autoAnalyzeTriggered = useRef(false);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    fetch(`/api/meetings/${id}`)
      .then((r) => r.json())
      .then((data: Meeting) => {
        setMeeting(data);
        setTitleDraft(data.title ?? "");
        setDateDraft(data.date ? data.date.slice(0, 10) : "");
        if (data.mindmapNodes?.length > 0) {
          setRawNodes(data.mindmapNodes);
          const { flowNodes, flowEdges } = buildFlowElements(data.mindmapNodes);
          setNodes(flowNodes);
          setEdges(flowEdges);
          setAnalyzed(true);
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // autoAnalyze: transcript読み込み後に自動で分析を開始
  useEffect(() => {
    if (!autoAnalyze || !meeting || autoAnalyzeTriggered.current) return;
    if (!meeting.transcript || analyzed || analyzing) return;
    autoAnalyzeTriggered.current = true;
    runAnalysis();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting, autoAnalyze]);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus();
  }, [editingTitle]);

  // 連絡先モーダル用: 検索
  useEffect(() => {
    if (!showContactModal) return;
    const timer = setTimeout(() => {
      fetch(`/api/contacts?q=${encodeURIComponent(contactQuery)}`)
        .then((r) => r.json())
        .then(setContacts);
    }, 200);
    return () => clearTimeout(timer);
  }, [showContactModal, contactQuery]);

  const runAnalysis = useCallback(async () => {
    if (!meeting?.transcript) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meeting_id: id,
          transcript: meeting.transcript,
          contact_name: meeting.contact?.name,
          contact_org: meeting.contact?.organization,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setRawNodes(data.nodes);
        const { flowNodes, flowEdges } = buildFlowElements(data.nodes);
        setNodes(flowNodes);
        setEdges(flowEdges);
        setAnalyzed(true);
        setMeeting((prev) => prev ? { ...prev, status: "completed", title: data.analysis?.root?.label ?? prev.title } : prev);
        setTitleDraft(data.analysis?.root?.label ?? "");
        showToast("分析完了", "success");
      } else {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error ?? "AI分析に失敗しました";
        showToast(errMsg, "error");
      }
    } catch (e) {
      showToast(`エラー: ${(e as Error).message}`, "error");
    }
    setAnalyzing(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting, id, showToast]);

  async function saveDate() {
    if (!dateDraft) return;
    const res = await fetch(`/api/meetings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: new Date(dateDraft).toISOString() }),
    });
    if (res.ok) {
      setMeeting((prev) => prev ? { ...prev, date: dateDraft } : prev);
      showToast("日付を保存しました", "success");
    } else {
      showToast("保存に失敗しました", "error");
    }
    setEditingDate(false);
  }

  async function saveTitle() {
    if (!titleDraft.trim()) return;
    const res = await fetch(`/api/meetings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: titleDraft.trim() }),
    });
    if (res.ok) {
      setMeeting((prev) => prev ? { ...prev, title: titleDraft.trim() } : prev);
      showToast("タイトルを保存しました", "success");
    } else {
      showToast("保存に失敗しました", "error");
    }
    setEditingTitle(false);
  }

  async function saveContacts() {
    const res = await fetch(`/api/meetings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds: selectedContactIds }),
    });
    if (res.ok) {
      const matched = contacts.filter((c) => selectedContactIds.includes(c.id));
      const newMeetingContacts = matched.map((c) => ({ contact: { id: c.id, name: c.name, organization: c.organization } }));
      setMeeting((prev) => prev ? {
        ...prev,
        contact: newMeetingContacts[0]?.contact ?? null,
        meetingContacts: newMeetingContacts,
      } : prev);
      showToast(
        selectedContactIds.length > 0
          ? `参加者を${selectedContactIds.length}名に設定しました`
          : "参加者を解除しました",
        "success"
      );
    } else {
      showToast("参加者の変更に失敗しました", "error");
    }
    setShowContactModal(false);
    setContactQuery("");
  }

  async function handleShare() {
    setSharing(true);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId: id, expiresInDays: 7 }),
      });
      if (res.ok) {
        const { token } = await res.json();
        const url = `${window.location.origin}/share/${token}`;
        setShareUrl(url);
        await navigator.clipboard.writeText(url).catch(() => {});
        showToast("共有URLをコピーしました", "success");
      } else {
        showToast("共有リンクの作成に失敗しました", "error");
      }
    } catch {
      showToast("共有リンクの作成に失敗しました", "error");
    }
    setSharing(false);
  }

  async function handleExport() {
    const text = exportAsText(rawNodes);
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    showToast("テキストをコピーしました", "success");
    setTimeout(() => setCopied(false), 2000);
  }

  async function toggleStar(node: MindmapNode) {
    const newVal = !node.isStarred;
    const res = await fetch(`/api/mindmap/nodes/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isStarred: newVal }),
    });
    if (res.ok) {
      const updated = rawNodes.map((n) => n.id === node.id ? { ...n, isStarred: newVal } : n);
      setRawNodes(updated);
      const { flowNodes, flowEdges } = buildFlowElements(updated);
      setNodes(flowNodes);
      setEdges(flowEdges);
      if (selectedNode?.id === node.id) setSelectedNode({ ...node, isStarred: newVal });
      showToast(newVal ? "⭐ クロスリンク候補に追加しました" : "星を外しました", "info");
    }
  }

  async function toggleVisibility(node: MindmapNode) {
    const newVal = !node.isVisible;
    const res = await fetch(`/api/mindmap/nodes/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isVisible: newVal }),
    });
    if (res.ok) {
      setRawNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, isVisible: newVal } : n));
      setNodes((prev) => prev.map((n) =>
        n.id === node.id ? { ...n, style: { ...n.style, opacity: newVal ? 1 : 0.35 } } : n
      ));
      if (selectedNode?.id === node.id) setSelectedNode({ ...node, isVisible: newVal });
    }
  }

  async function updateStatus(node: MindmapNode, status: string) {
    const res = await fetch(`/api/mindmap/nodes/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setRawNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, status } : n));
      if (selectedNode?.id === node.id) setSelectedNode({ ...node, status });
      showToast(`ステータスを「${status}」に変更しました`, "success");
    }
  }

  async function saveLabel(node: MindmapNode) {
    if (!labelDraft.trim() || labelDraft === node.label) { setEditingLabel(false); return; }
    const res = await fetch(`/api/mindmap/nodes/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: labelDraft.trim() }),
    });
    if (res.ok) {
      const newLabel = labelDraft.trim();
      setRawNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, label: newLabel } : n));
      setNodes((prev) => prev.map((n) => n.id === node.id ? { ...n, data: { ...n.data, label: newLabel } } : n));
      setSelectedNode({ ...node, label: newLabel });
      showToast("ラベルを保存しました", "success");
    } else {
      showToast("保存に失敗しました", "error");
    }
    setEditingLabel(false);
  }

  async function deleteNode(node: MindmapNode) {
    if (!confirm(`「${node.label}」を削除しますか？`)) return;
    const res = await fetch(`/api/mindmap/nodes/${node.id}`, { method: "DELETE" });
    if (res.ok) {
      setRawNodes((prev) => prev.filter((n) => n.id !== node.id));
      setNodes((prev) => prev.filter((n) => n.id !== node.id));
      setEdges((prev) => prev.filter((e) => e.source !== node.id && e.target !== node.id));
      setSelectedNode(null);
      showToast("ノードを削除しました", "info");
    }
  }

  if (!meeting) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">読み込み中...</p>
      </div>
    );
  }

  const hiddenCount = rawNodes.filter((n) => !n.isVisible).length;
  const starredCount = rawNodes.filter((n) => n.isStarred).length;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* トースト */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <header className="bg-white border-b border-gray-100 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center gap-2">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-xl flex-shrink-0">←</Link>

          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
              className="flex-1 text-sm font-bold text-gray-800 bg-gray-100 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          ) : (
            <button
              onClick={() => setEditingTitle(true)}
              className="flex-1 text-sm font-bold text-gray-800 text-left truncate hover:text-indigo-600 transition-colors"
              title="クリックで編集"
            >
              {meeting.title ?? "タイトルなし"}
            </button>
          )}

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* 参加者（クリックで変更） */}
            <button
              onClick={() => {
                setSelectedContactIds(meeting.meetingContacts.map((mc) => mc.contact.id));
                setShowContactModal(true);
              }}
              className="text-xs text-gray-400 hover:text-indigo-500 transition-colors hidden sm:block"
              title="参加者を変更"
            >
              {meeting.meetingContacts.length > 0
                ? meeting.meetingContacts.map((mc) => mc.contact.name).join("・")
                : "参加者なし"}
            </button>

            {/* 日付 */}
            {editingDate ? (
              <input
                type="date"
                value={dateDraft}
                onChange={(e) => setDateDraft(e.target.value)}
                onBlur={saveDate}
                autoFocus
                className="text-xs text-gray-500 bg-gray-100 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            ) : (
              <button
                onClick={() => setEditingDate(true)}
                className="text-xs text-gray-400 hover:text-indigo-500 transition-colors"
                title="日付を編集"
              >
                {meeting.date ? new Date(meeting.date).toLocaleDateString("ja-JP") : "日付"}
              </button>
            )}

            {meeting.transcript && (
              <button
                onClick={runAnalysis}
                disabled={analyzing}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-indigo-100 hover:bg-indigo-200 text-indigo-700 transition-colors disabled:opacity-50 font-medium"
              >
                {analyzing ? "分析中..." : analyzed ? "🔄 再分析" : "🤖 AI分析"}
              </button>
            )}
            {analyzed && (
              <>
                <button
                  onClick={handleExport}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                >
                  {copied ? "✓" : "📋"}
                </button>
                <button
                  onClick={handleShare}
                  disabled={sharing}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors disabled:opacity-50"
                >
                  {sharing ? "..." : shareUrl ? "✓" : "🔗"}
                </button>
              </>
            )}
          </div>
        </div>

        {/* モバイル用: 参加者表示 */}
        <div className="max-w-4xl mx-auto mt-1 sm:hidden">
          <button
            onClick={() => {
              setSelectedContactIds(meeting.meetingContacts.map((mc) => mc.contact.id));
              setShowContactModal(true);
            }}
            className="text-xs text-gray-400 hover:text-indigo-500 transition-colors"
          >
            👥 {meeting.meetingContacts.length > 0
              ? meeting.meetingContacts.map((mc) => mc.contact.name).join("・")
              : "参加者なし（タップで変更）"}
          </button>
        </div>
      </header>

      {/* タブ */}
      <div className="bg-white border-b border-gray-100 px-4">
        <div className="max-w-4xl mx-auto flex gap-4">
          {(["map", "transcript"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t ? "border-indigo-500 text-indigo-600" : "border-transparent text-gray-400"
              }`}
            >
              {t === "map" ? "🗺️ マインドマップ" : "📝 文字起こし"}
            </button>
          ))}
        </div>
      </div>

      {tab === "map" && (
        <div className="flex-1 flex flex-col">
          {!analyzed && !analyzing && (
            <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-3 text-center text-sm text-indigo-700">
              {meeting.transcript ? "ヘッダーの「🤖 AI分析」ボタンを押してマインドマップを生成してください" : "文字起こしデータがありません"}
            </div>
          )}
          {analyzed && (hiddenCount > 0 || starredCount > 0) && (
            <div className="bg-amber-50 px-4 py-1.5 text-xs text-amber-600 text-center flex items-center justify-center gap-3">
              {starredCount > 0 && <span>⭐ {starredCount}件がクロスリンク候補</span>}
              {hiddenCount > 0 && <span>{hiddenCount}件が非表示</span>}
            </div>
          )}
          <div style={{ height: 600, width: "100%" }}>
            {analyzing ? (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="w-10 h-10 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
                <p className="text-gray-400 text-sm">AIが分析中...</p>
              </div>
            ) : analyzed && nodes.length > 0 ? (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={(_, node) => {
                  const raw = rawNodes.find((n) => n.id === node.id);
                  if (raw) { setSelectedNode(raw); setLabelDraft(raw.label); setEditingLabel(false); }
                }}
                fitView
                fitViewOptions={{ padding: 0.3 }}
              >
                <Background color="#e5e7eb" gap={20} />
                <Controls />
              </ReactFlow>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                ノードがありません
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "transcript" && (
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            {meeting.transcript ? (
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {meeting.transcript}
              </p>
            ) : (
              <p className="text-gray-400 text-sm text-center py-8">文字起こしデータがありません</p>
            )}
          </div>
        </div>
      )}

      {/* ノード詳細パネル */}
      {selectedNode && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-4 shadow-lg z-20">
          <div className="max-w-2xl mx-auto space-y-3">
            <div className="flex items-start gap-2">
              {editingLabel ? (
                <input
                  autoFocus
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onBlur={() => saveLabel(selectedNode)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveLabel(selectedNode);
                    if (e.key === "Escape") setEditingLabel(false);
                  }}
                  className="flex-1 text-sm font-medium text-gray-800 bg-gray-100 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              ) : (
                <button
                  onClick={() => { setEditingLabel(true); setLabelDraft(selectedNode.label); }}
                  className="flex-1 text-sm font-medium text-gray-800 text-left hover:text-indigo-600 transition-colors"
                  title="クリックで編集"
                >
                  {selectedNode.label}
                </button>
              )}
              <button
                onClick={() => deleteNode(selectedNode)}
                className="text-gray-300 hover:text-red-400 transition-colors text-sm flex-shrink-0"
                title="削除"
              >
                🗑
              </button>
              <button onClick={() => setSelectedNode(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">✕</button>
            </div>

            <div className="flex flex-wrap gap-1.5 items-center">
              {NODE_STATUS_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => updateStatus(selectedNode, s)}
                  className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                    selectedNode.status === s
                      ? STATUS_COLORS[s as NodeStatus] + " border-transparent"
                      : "border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  {s}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={() => toggleStar(selectedNode)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    selectedNode.isStarred
                      ? "border-amber-400 bg-amber-50 text-amber-600"
                      : "border-gray-200 text-gray-400 hover:border-amber-300 hover:text-amber-500"
                  }`}
                  title="クロスリンク候補にする"
                >
                  {selectedNode.isStarred ? "⭐ 候補中" : "☆ 候補にする"}
                </button>
                <button
                  onClick={() => toggleVisibility(selectedNode)}
                  className="text-xs px-3 py-1 rounded-full border border-gray-200 text-gray-500 hover:border-gray-300"
                >
                  {selectedNode.isVisible ? "👁" : "🙈"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 参加者変更モーダル（複数選択） */}
      {showContactModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[80vh]">
            <div className="px-5 pt-5 pb-3">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-base font-semibold text-gray-800">参加者を変更</h2>
                <button onClick={() => { setShowContactModal(false); setContactQuery(""); }} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
              <p className="text-xs text-gray-400 mb-3">複数選択できます</p>
              <input
                type="text"
                value={contactQuery}
                onChange={(e) => setContactQuery(e.target.value)}
                placeholder="名前・組織で検索..."
                autoFocus
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {contacts.length === 0 ? (
                <div className="px-5 py-8 text-center text-gray-400 text-sm">
                  連絡先が見つかりません
                </div>
              ) : (
                contacts.map((c) => {
                  const isSelected = selectedContactIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedContactIds((prev) =>
                        isSelected ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                      )}
                      className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${
                        isSelected ? "bg-indigo-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${
                        isSelected ? "bg-indigo-500 text-white" : "bg-indigo-100 text-indigo-600"
                      }`}>
                        {isSelected ? "✓" : c.name[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${isSelected ? "text-indigo-700" : "text-gray-800"}`}>{c.name}</p>
                        {c.organization && <p className="text-xs text-gray-400 truncate">{c.organization}</p>}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 space-y-2">
              <button
                onClick={saveContacts}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
              >
                {selectedContactIds.length > 0
                  ? `${selectedContactIds.length}名を参加者に設定`
                  : "参加者なしで保存"}
              </button>
              <div className="flex items-center justify-between">
                {selectedContactIds.length > 0 && (
                  <button
                    onClick={() => setSelectedContactIds([])}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    選択をすべて解除
                  </button>
                )}
                <Link
                  href="/contacts"
                  onClick={() => setShowContactModal(false)}
                  className="text-xs text-indigo-600 hover:underline ml-auto"
                >
                  ＋ 新しい連絡先を作成
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
