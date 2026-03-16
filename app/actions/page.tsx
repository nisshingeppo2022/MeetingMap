"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ActionNode {
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

export default function ActionsPage() {
  const [nodes, setNodes] = useState<ActionNode[]>([]);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/actions")
      .then((r) => r.json())
      .then(setNodes);
  }, []);

  async function handleToggle(node: ActionNode, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (toggling === node.id) return;
    setToggling(node.id);
    const newStatus = node.status === "完了" ? null : "完了";
    await fetch(`/api/mindmap/nodes/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    setNodes((prev) =>
      prev.map((n) => (n.id === node.id ? { ...n, status: newStatus } : n))
    );
    setToggling(null);
  }

  const pending = nodes.filter((n) => n.status !== "完了");
  const done = nodes.filter((n) => n.status === "完了");

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-xl">←</Link>
          <h1 className="text-base font-bold text-gray-800 flex-1">アクションアイテム</h1>
          {pending.length > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              {pending.length}件未完了
            </span>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {nodes.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
            <p className="text-gray-400 text-sm">アクションアイテムがまだありません</p>
            <p className="text-gray-400 text-xs mt-1">ミーティングのAI分析を実行すると自動で追加されます</p>
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-500 mb-2">未完了（{pending.length}件）</h2>
                <div className="space-y-2">
                  {pending.map((node) => (
                    <div key={node.id} className="bg-white rounded-xl border border-gray-100 shadow-sm">
                      <div className="flex items-start gap-3 px-4 py-3">
                        <button
                          onClick={(e) => handleToggle(node, e)}
                          disabled={toggling === node.id}
                          className="mt-0.5 w-5 h-5 rounded border-2 border-amber-400 flex-shrink-0 hover:bg-amber-50 transition-colors disabled:opacity-50 flex items-center justify-center"
                        />
                        <Link
                          href={`/meetings/${node.meetingId}/result`}
                          className="flex-1 min-w-0"
                        >
                          <p className="text-sm font-medium text-gray-800">{node.label}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {node.meeting.title ?? "タイトルなし"} ·{" "}
                            {node.meeting.contact?.name ?? "相手未設定"} ·{" "}
                            {new Date(node.meeting.date).toLocaleDateString("ja-JP")}
                          </p>
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {done.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-400 mb-2">完了（{done.length}件）</h2>
                <div className="space-y-2">
                  {done.map((node) => (
                    <div key={node.id} className="bg-white rounded-xl border border-gray-100 shadow-sm opacity-60">
                      <div className="flex items-start gap-3 px-4 py-3">
                        <button
                          onClick={(e) => handleToggle(node, e)}
                          disabled={toggling === node.id}
                          className="mt-0.5 w-5 h-5 rounded border-2 border-green-400 bg-green-400 flex-shrink-0 hover:bg-green-500 transition-colors disabled:opacity-50 flex items-center justify-center"
                        >
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                        <Link
                          href={`/meetings/${node.meetingId}/result`}
                          className="flex-1 min-w-0"
                        >
                          <p className="text-sm font-medium text-gray-400 line-through">{node.label}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {node.meeting.title ?? "タイトルなし"} ·{" "}
                            {node.meeting.contact?.name ?? "相手未設定"} ·{" "}
                            {new Date(node.meeting.date).toLocaleDateString("ja-JP")}
                          </p>
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
