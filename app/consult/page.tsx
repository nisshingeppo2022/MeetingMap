"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface ProjectTag {
  slug: string;
  label: string;
}

interface Breakdown {
  meetings: number;
  memos: number;
  clips: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ConsultPage() {
  const [projects, setProjects] = useState<ProjectTag[]>([]);
  const [recentTags, setRecentTags] = useState<ProjectTag[]>([]);
  const [tagSlug, setTagSlug] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadContext() {
      const res = await fetch(`/api/consult${tagSlug ? `?tag=${encodeURIComponent(tagSlug)}` : ""}`);
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects);
        setRecentTags(data.recentTags ?? []);
        setBreakdown(data.breakdown);
      }
    }
    loadContext();
  }, [tagSlug]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function showToast(text: string) {
    setToast(text);
    setTimeout(() => setToast(null), 3000);
  }

  function switchContext(slug: string | null) {
    if (streaming) return;
    if (messages.length > 0 && !confirm("文脈を切り替えると会話がリセットされます。よろしいですか？")) return;
    setTagSlug(slug);
    setMessages([]);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    const nextMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const res = await fetch("/api/consult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, tagSlug }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "AIの呼び出しに失敗しました");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        const current = assistantText;
        setMessages([...nextMessages, { role: "assistant", content: current }]);
      }
      if (!assistantText.trim()) {
        setMessages(nextMessages);
        showToast("応答が空でした。もう一度お試しください");
      }
    } catch (e) {
      setMessages(nextMessages);
      showToast(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setStreaming(false);
    }
  }

  async function handleSave() {
    if (messages.length === 0 || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/consult/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, tagSlug }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "保存に失敗しました");
      }
      const data = await res.json();
      showToast(`相談を保存しました${data.label ? ` #${data.label}` : ""}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-dvh bg-gray-50 flex flex-col overflow-hidden">
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex-shrink-0 z-10">
        <div className="max-w-2xl mx-auto space-y-2">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-600 active:text-indigo-600 active:scale-75 transition-all text-xl">←</Link>
            <h1 className="text-lg font-bold text-gray-800 flex-1">相談</h1>
            {messages.length > 0 && (
              <button
                onClick={handleSave}
                disabled={saving || streaming}
                className="text-xs px-3 py-1.5 rounded-full bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 text-indigo-600 font-medium transition-colors"
              >
                {saving ? "保存中..." : "💾 この相談を保存"}
              </button>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-0.5 -mx-1 px-1">
            <button
              onClick={() => switchContext(null)}
              className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                tagSlug === null
                  ? "bg-indigo-600 border-indigo-600 text-white"
                  : "bg-white border-gray-200 text-gray-600 hover:border-indigo-300"
              }`}
            >
              最近2週間
            </button>
            {projects.map((p) => (
              <button
                key={p.slug}
                onClick={() => switchContext(p.slug)}
                className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  tagSlug === p.slug
                    ? "bg-indigo-600 border-indigo-600 text-white"
                    : "bg-white border-gray-200 text-gray-600 hover:border-indigo-300"
                }`}
              >
                📁 {p.label}
              </button>
            ))}
            {recentTags.map((t) => (
              <button
                key={t.slug}
                onClick={() => switchContext(t.slug)}
                className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  tagSlug === t.slug
                    ? "bg-indigo-600 border-indigo-600 text-white"
                    : "bg-white border-dashed border-gray-300 text-gray-500 hover:border-indigo-300"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {breakdown && (
            <p className="text-xs text-gray-400">
              文脈: 議事録{breakdown.meetings}件・メモ{breakdown.memos}件・クリップ{breakdown.clips}件
            </p>
          )}
        </div>
      </header>

      <main className="flex-1 min-h-0 max-w-2xl mx-auto w-full px-4 py-4 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="text-center py-16 space-y-2">
            <p className="text-3xl">💬</p>
            <p className="text-sm text-gray-500">
              {tagSlug
                ? "このプロジェクトの経緯を知った状態で相談に乗ります"
                : "直近2週間のメモ・議事録を知った状態で相談に乗ります"}
            </p>
            <p className="text-xs text-gray-400">気になっていることを話しかけてください</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
                m.role === "user"
                  ? "bg-indigo-600 text-white rounded-br-md"
                  : "bg-white border border-gray-100 text-gray-800 shadow-sm rounded-bl-md"
              }`}
            >
              {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      <div className="bg-white border-t border-gray-100 px-4 pt-3 flex-shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="max-w-2xl mx-auto flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="相談したいことを入力..."
            rows={1}
            className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
          />
          <button
            onClick={handleSend}
            disabled={streaming || !input.trim()}
            className="flex-shrink-0 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-xl text-sm font-medium transition-colors"
          >
            {streaming ? "..." : "送信"}
          </button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-full shadow-lg z-20">
          {toast}
        </div>
      )}
    </div>
  );
}
