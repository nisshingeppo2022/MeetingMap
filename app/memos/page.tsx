"use client";

import { useState, useEffect, useRef } from "react";

type QuickMemo = {
  id: string;
  content: string;
  tags: string[];
  isPinned: boolean;
  createdAt: string;
};

export default function MemosPage() {
  const [memos, setMemos] = useState<QuickMemo[]>([]);
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [loading, setLoading] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/memos")
      .then((r) => r.json())
      .then(setMemos)
      .finally(() => setLoading(false));
  }, []);

  async function handleAdd() {
    if (!input.trim()) return;
    const res = await fetch("/api/memos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: input.trim() }),
    });
    if (res.ok) {
      const memo = await res.json();
      setMemos((prev) => [memo, ...prev]);
      setInput("");
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/memos/${id}`, { method: "DELETE" });
    setMemos((prev) => prev.filter((m) => m.id !== id));
  }

  async function handleTogglePin(memo: QuickMemo) {
    await fetch(`/api/memos/${memo.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPinned: !memo.isPinned }),
    });
    setMemos((prev) =>
      prev
        .map((m) => (m.id === memo.id ? { ...m, isPinned: !m.isPinned } : m))
        .sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0))
    );
  }

  async function handleEditSave(id: string) {
    if (!editContent.trim()) return;
    await fetch(`/api/memos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editContent.trim() }),
    });
    setMemos((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content: editContent.trim() } : m))
    );
    setEditingId(null);
  }

  function startEdit(memo: QuickMemo) {
    setEditingId(memo.id);
    setEditContent(memo.content);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  const pinned = memos.filter((m) => m.isPinned);
  const unpinned = memos.filter((m) => !m.isPinned);

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-base font-bold text-gray-800">クイックメモ</h1>
          <p className="text-xs text-gray-400 mt-0.5">会議外のアイデアを記録。AIブリーフィングに活用されます</p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* 入力エリア */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAdd();
            }}
            placeholder="アイデアや気づきをメモ... (⌘+Enterで保存)"
            className="w-full text-sm text-gray-800 placeholder-gray-300 resize-none focus:outline-none"
            rows={3}
          />
          <div className="flex justify-end mt-2">
            <button
              onClick={handleAdd}
              disabled={!input.trim()}
              className="text-sm font-medium bg-indigo-600 text-white px-4 py-1.5 rounded-lg disabled:opacity-40 transition-opacity"
            >
              保存
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-center text-sm text-gray-400 py-8">読み込み中...</p>
        ) : memos.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
            <p className="text-gray-400 text-sm">まだメモがありません</p>
            <p className="text-gray-400 text-xs mt-1">会議以外で気づいたアイデアを記録しましょう</p>
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-gray-400 mb-2 px-1">ピン留め</h2>
                <div className="space-y-2">
                  {pinned.map((memo) => (
                    <MemoCard
                      key={memo.id}
                      memo={memo}
                      editingId={editingId}
                      editContent={editContent}
                      textareaRef={editingId === memo.id ? textareaRef : undefined}
                      onEdit={startEdit}
                      onEditChange={setEditContent}
                      onEditSave={handleEditSave}
                      onEditCancel={() => setEditingId(null)}
                      onPin={handleTogglePin}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            )}
            {unpinned.length > 0 && (
              <div>
                {pinned.length > 0 && (
                  <h2 className="text-xs font-semibold text-gray-400 mb-2 px-1">メモ</h2>
                )}
                <div className="space-y-2">
                  {unpinned.map((memo) => (
                    <MemoCard
                      key={memo.id}
                      memo={memo}
                      editingId={editingId}
                      editContent={editContent}
                      textareaRef={editingId === memo.id ? textareaRef : undefined}
                      onEdit={startEdit}
                      onEditChange={setEditContent}
                      onEditSave={handleEditSave}
                      onEditCancel={() => setEditingId(null)}
                      onPin={handleTogglePin}
                      onDelete={handleDelete}
                    />
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

function MemoCard({
  memo,
  editingId,
  editContent,
  textareaRef,
  onEdit,
  onEditChange,
  onEditSave,
  onEditCancel,
  onPin,
  onDelete,
}: {
  memo: QuickMemo;
  editingId: string | null;
  editContent: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  onEdit: (m: QuickMemo) => void;
  onEditChange: (v: string) => void;
  onEditSave: (id: string) => void;
  onEditCancel: () => void;
  onPin: (m: QuickMemo) => void;
  onDelete: (id: string) => void;
}) {
  const isEditing = editingId === memo.id;

  return (
    <div className={`bg-white rounded-xl border shadow-sm px-4 py-3 ${memo.isPinned ? "border-indigo-100" : "border-gray-100"}`}>
      {isEditing ? (
        <>
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => onEditChange(e.target.value)}
            className="w-full text-sm text-gray-800 resize-none focus:outline-none"
            rows={3}
          />
          <div className="flex gap-2 justify-end mt-2">
            <button onClick={onEditCancel} className="text-xs text-gray-400 px-3 py-1 rounded-lg hover:bg-gray-50">
              キャンセル
            </button>
            <button
              onClick={() => onEditSave(memo.id)}
              className="text-xs font-medium text-white bg-indigo-600 px-3 py-1 rounded-lg"
            >
              保存
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-start gap-2">
          <p className="flex-1 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{memo.content}</p>
          <div className="flex gap-1 flex-shrink-0 mt-0.5">
            <button
              onClick={() => onPin(memo)}
              className={`p-1 rounded-lg transition-colors ${memo.isPinned ? "text-indigo-500" : "text-gray-300 hover:text-gray-500"}`}
              title={memo.isPinned ? "ピン解除" : "ピン留め"}
            >
              📌
            </button>
            <button
              onClick={() => onEdit(memo)}
              className="p-1 rounded-lg text-gray-300 hover:text-gray-500 transition-colors"
              title="編集"
            >
              ✏️
            </button>
            <button
              onClick={() => onDelete(memo.id)}
              className="p-1 rounded-lg text-gray-300 hover:text-red-400 transition-colors"
              title="削除"
            >
              🗑️
            </button>
          </div>
        </div>
      )}
      {!isEditing && (
        <p className="text-xs text-gray-300 mt-2">
          {new Date(memo.createdAt).toLocaleDateString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </div>
  );
}
