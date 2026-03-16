"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface MindmapNode {
  id: string;
  label: string;
  status: string | null;
  meetingId: string;
  createdAt: string;
  meeting: {
    title: string | null;
    date: string;
    contact: { name: string } | null;
  };
}

const STATUS_OPTIONS = ["", "企画中", "調整中", "進行中", "アイデア段階", "完了", "保留"];

const STATUS_COLORS: Record<string, string> = {
  "企画中": "bg-blue-100 text-blue-700",
  "調整中": "bg-yellow-100 text-yellow-700",
  "進行中": "bg-green-100 text-green-700",
  "アイデア段階": "bg-purple-100 text-purple-700",
  "完了": "bg-gray-100 text-gray-600",
  "保留": "bg-red-100 text-red-700",
};

export default function TopicsPage() {
  const [nodes, setNodes] = useState<MindmapNode[]>([]);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/topics")
      .then((r) => r.json())
      .then(setNodes);
  }, []);

  async function handleStatusChange(nodeId: string, status: string) {
    setUpdating(nodeId);
    await fetch(`/api/mindmap/nodes/${nodeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: status || null }),
    });
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, status: status || null } : n))
    );
    setUpdating(null);
  }

  // ラベルでグループ化
  const grouped = new Map<string, MindmapNode[]>();
  for (const node of nodes) {
    if (!grouped.has(node.label)) grouped.set(node.label, []);
    grouped.get(node.label)!.push(node);
  }
  const groupedArray = Array.from(grouped.entries()).sort(
    (a, b) => b[1].length - a[1].length
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-xl">←</Link>
          <h1 className="text-base font-bold text-gray-800">トピック別</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {groupedArray.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
            <p className="text-gray-400 text-sm">トピックがまだありません</p>
            <p className="text-gray-400 text-xs mt-1">ミーティングのAI分析を実行するとトピックが作成されます</p>
          </div>
        ) : (
          groupedArray.map(([label, groupNodes]) => (
            <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                <h2 className="font-semibold text-gray-800 text-sm">{label}</h2>
                <span className="text-xs text-gray-400">{groupNodes.length}件のミーティング</span>
              </div>
              <div className="divide-y divide-gray-50">
                {groupNodes.map((node) => (
                  <div key={node.id} className="flex items-center gap-2 px-4 py-3">
                    <Link
                      href={`/meetings/${node.meetingId}/result`}
                      className="flex-1 min-w-0 hover:opacity-70 transition-opacity"
                    >
                      <p className="text-sm text-gray-700 truncate">
                        {node.meeting.title ?? "タイトルなし"}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {node.meeting.contact?.name ?? "相手未設定"} ·{" "}
                        {new Date(node.meeting.date).toLocaleDateString("ja-JP")}
                      </p>
                    </Link>
                    <select
                      value={node.status ?? ""}
                      onChange={(e) => handleStatusChange(node.id, e.target.value)}
                      disabled={updating === node.id}
                      className={`flex-shrink-0 text-xs px-2 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50 ${
                        node.status
                          ? STATUS_COLORS[node.status] ?? "bg-gray-100 text-gray-600"
                          : "bg-gray-50 text-gray-400"
                      }`}
                    >
                      <option value="">未設定</option>
                      {STATUS_OPTIONS.filter(Boolean).map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  );
}
