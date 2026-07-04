"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

interface TagChip {
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

interface SessionSummary {
  id: string;
  title: string;
  mode: string;
  tagSlug: string | null;
  tagLabel: string | null;
  updatedAt: string;
}

type ConsultMode = "recent" | "tag" | "none";

export default function ConsultPage() {
  const [projects, setProjects] = useState<TagChip[]>([]);
  const [recentTags, setRecentTags] = useState<TagChip[]>([]);
  const [mode, setMode] = useState<ConsultMode>("recent");
  const [tagSlug, setTagSlug] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  // 音声入力(録音ページと同じフックを使用)
  const { segments, isListening, isSupported, start: startSpeech, stop: stopSpeech } = useSpeechRecognition();
  const speechBaseTextRef = useRef("");
  const speechBaseCountRef = useRef(0);

  useEffect(() => {
    async function loadContext() {
      const params = new URLSearchParams();
      params.set("mode", mode);
      if (mode === "tag" && tagSlug) params.set("tag", tagSlug);
      const res = await fetch(`/api/consult?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects);
        setRecentTags(data.recentTags ?? []);
        setBreakdown(data.breakdown);
      }
    }
    loadContext();
  }, [mode, tagSlug]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function showToast(text: string) {
    setToast(text);
    setTimeout(() => setToast(null), 3000);
  }

  // --- 音声入力 ---
  // 認識確定した発話(segments)のうち、今回のマイク起動以降の分を入力欄に反映する
  useEffect(() => {
    if (!isListening) return;
    const newSegments = segments.slice(speechBaseCountRef.current);
    if (newSegments.length > 0) {
      setInput(speechBaseTextRef.current + newSegments.map((s) => s.text).join(" "));
    }
  }, [segments, isListening]);

  function toggleMic() {
    if (isListening) {
      stopSpeech();
      return;
    }
    if (!isSupported) {
      showToast("この端末では音声入力が使えません。キーボードのマイクをご利用ください");
      return;
    }
    speechBaseTextRef.current = input ? `${input} ` : "";
    speechBaseCountRef.current = segments.length;
    startSpeech();
  }

  function confirmDiscard(): boolean {
    return messages.length === 0 || confirm("文脈を切り替えると新しい相談になります。よろしいですか？(今の相談は履歴に残っています)");
  }

  // チップのタップ。選択中のチップをもう一度押すと解除(文脈なし)になる
  function toggleContext(next: ConsultMode, slug: string | null) {
    if (streaming) return;
    const isSame = mode === next && tagSlug === slug;
    const newMode: ConsultMode = isSame ? "none" : next;
    const newSlug = isSame ? null : slug;
    if (newMode === mode && newSlug === tagSlug) return;
    if (!confirmDiscard()) return;
    setMode(newMode);
    setTagSlug(newSlug);
    setMessages([]);
    setSessionId(null);
    setCanRetry(false);
  }

  function startNewChat() {
    if (streaming) return;
    if (!confirmDiscard()) return;
    setMessages([]);
    setSessionId(null);
    setCanRetry(false);
    setShowHistory(false);
  }

  async function openHistory() {
    setShowHistory(true);
    setHistoryLoading(true);
    const res = await fetch("/api/consult/sessions");
    if (res.ok) setSessions(await res.json());
    setHistoryLoading(false);
  }

  async function resumeSession(id: string) {
    const res = await fetch(`/api/consult/sessions/${id}`);
    if (!res.ok) {
      showToast("読み込みに失敗しました");
      return;
    }
    const data = await res.json();
    const loaded: Message[] = Array.isArray(data.messages) ? data.messages : [];
    setMode(data.mode === "tag" || data.mode === "none" ? data.mode : "recent");
    setTagSlug(data.tagSlug ?? null);
    setMessages(loaded);
    setSessionId(data.id);
    setCanRetry(false);
    setShowHistory(false);
  }

  async function deleteSession(id: string) {
    if (!confirm("この相談履歴を削除しますか？")) return;
    const res = await fetch(`/api/consult/sessions/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (sessionId === id) {
        setMessages([]);
        setSessionId(null);
      }
    } else {
      showToast("削除に失敗しました");
    }
  }

  // 会話を送信する。失敗時はユーザー発言を残したまま再送可能にする
  async function sendConversation(nextMessages: Message[]) {
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setStreaming(true);
    setCanRetry(false);

    try {
      const res = await fetch("/api/consult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, mode, tagSlug, sessionId }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "AIの呼び出しに失敗しました");
      }
      const newSessionId = res.headers.get("X-Session-Id");
      if (newSessionId) setSessionId(newSessionId);

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
        setCanRetry(true);
        showToast("応答が空でした。時間を置いて再送してください");
      } else {
        // 会話全文を履歴に保存(サーバーはストリーム完了後の処理を保証できないためクライアントから)
        const sid = newSessionId ?? sessionId;
        if (sid) {
          fetch(`/api/consult/sessions/${sid}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [...nextMessages, { role: "assistant", content: assistantText }],
            }),
          }).catch(() => {});
        }
      }
    } catch (e) {
      setMessages(nextMessages);
      setCanRetry(true);
      showToast(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setStreaming(false);
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    if (isListening) stopSpeech();
    setInput("");
    await sendConversation([...messages, { role: "user", content: text }]);
  }

  async function handleRetry() {
    if (streaming || messages.length === 0) return;
    if (messages[messages.length - 1].role !== "user") return;
    await sendConversation(messages);
  }

  async function handleSendToObsidian() {
    if (messages.length === 0 || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/consult/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, mode, tagSlug }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "送信に失敗しました");
      }
      const data = await res.json();
      showToast(`Obsidianへ送りました${data.label ? ` #${data.label}` : ""}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  const chipClass = (selected: boolean, dashed = false) =>
    `flex-shrink-0 text-xs px-3 py-1.5 rounded-full border transition-all active:scale-95 ${
      selected
        ? "bg-indigo-600 border-indigo-600 text-white"
        : `bg-white ${dashed ? "border-dashed border-gray-300 text-gray-500" : "border-gray-200 text-gray-600"} hover:border-indigo-300`
    }`;

  return (
    <div className="h-dvh bg-gray-50 flex flex-col overflow-hidden">
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex-shrink-0 z-10">
        <div className="max-w-2xl mx-auto space-y-2">
          <div className="flex items-center gap-3">
            {showHistory ? (
              <button
                onClick={() => setShowHistory(false)}
                className="text-gray-400 hover:text-gray-600 active:text-indigo-600 active:scale-75 transition-all text-xl"
              >
                ←
              </button>
            ) : (
              <Link href="/" className="text-gray-400 hover:text-gray-600 active:text-indigo-600 active:scale-75 transition-all text-xl">←</Link>
            )}
            <h1 className="text-lg font-bold text-gray-800 flex-1">{showHistory ? "相談履歴" : "相談"}</h1>
            {!showHistory && (
              <button
                onClick={openHistory}
                className="text-xs px-3 py-1.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium transition-all active:scale-95"
              >
                🕘 履歴
              </button>
            )}
            {messages.length > 0 && !showHistory && (
              <button
                onClick={handleSendToObsidian}
                disabled={saving || streaming}
                title="Obsidianへ送る"
                className="text-base w-9 h-9 flex items-center justify-center rounded-full bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 transition-all active:scale-95"
              >
                {saving ? "..." : "🗂️"}
              </button>
            )}
          </div>
          {!showHistory && (
            <>
              <div className="flex gap-2 overflow-x-auto pb-0.5 -mx-1 px-1">
                <button onClick={() => toggleContext("recent", null)} className={chipClass(mode === "recent")}>
                  最近2週間
                </button>
                {projects.map((p) => (
                  <button
                    key={p.slug}
                    onClick={() => toggleContext("tag", p.slug)}
                    className={chipClass(mode === "tag" && tagSlug === p.slug)}
                  >
                    📁 {p.label}
                  </button>
                ))}
                {recentTags.map((t) => (
                  <button
                    key={t.slug}
                    onClick={() => toggleContext("tag", t.slug)}
                    className={chipClass(mode === "tag" && tagSlug === t.slug, true)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400">
                {mode === "none"
                  ? "文脈: なし(自由な相談) — チップを押すと過去の記録を読み込みます"
                  : breakdown
                    ? `文脈: 議事録${breakdown.meetings}件・メモ${breakdown.memos}件・クリップ${breakdown.clips}件`
                    : "文脈: 読み込み中..."}
              </p>
            </>
          )}
        </div>
      </header>

      {showHistory ? (
        <main className="flex-1 min-h-0 max-w-2xl mx-auto w-full px-4 py-4 space-y-2 overflow-y-auto">
          <button
            onClick={startNewChat}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white rounded-xl text-sm font-medium transition-all"
          >
            ＋ 新しい相談を始める
          </button>
          {historyLoading ? (
            <p className="text-center text-gray-400 text-sm py-8">読み込み中...</p>
          ) : sessions.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">まだ相談履歴がありません</p>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className={`bg-white rounded-xl border px-4 py-3 shadow-sm flex items-center gap-3 ${
                  s.id === sessionId ? "border-indigo-300" : "border-gray-100"
                }`}
              >
                <button onClick={() => resumeSession(s.id)} className="flex-1 min-w-0 text-left active:opacity-60 transition-opacity">
                  <p className="text-sm font-medium text-gray-800 truncate">{s.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(s.updatedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {" · "}
                    {s.mode === "none" ? "文脈なし" : s.mode === "recent" ? "最近2週間" : s.tagLabel ?? s.tagSlug}
                  </p>
                </button>
                <button
                  onClick={() => deleteSession(s.id)}
                  className="flex-shrink-0 text-xs px-2.5 py-1.5 rounded-full bg-red-50 hover:bg-red-100 active:scale-95 text-red-500 transition-all"
                >
                  削除
                </button>
              </div>
            ))
          )}
        </main>
      ) : (
        <main className="flex-1 min-h-0 max-w-2xl mx-auto w-full px-4 py-4 space-y-3 overflow-y-auto">
          {messages.length === 0 && (
            <div className="text-center py-16 space-y-2">
              <p className="text-3xl">💬</p>
              <p className="text-sm text-gray-500">
                {mode === "none"
                  ? "過去の記録は読み込まない、自由な相談です"
                  : mode === "tag"
                    ? "このトピックの経緯を知った状態で相談に乗ります"
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
          {canRetry && !streaming && (
            <div className="flex justify-center">
              <button
                onClick={handleRetry}
                className="text-xs px-4 py-2 rounded-full bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 font-medium transition-all active:scale-95"
              >
                🔄 送信できませんでした — もう一度送る
              </button>
            </div>
          )}
          <div ref={bottomRef} />
        </main>
      )}

      {!showHistory && (
        <div className="bg-white border-t border-gray-100 px-4 pt-3 flex-shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="max-w-2xl mx-auto flex gap-2 items-end">
            <button
              onClick={toggleMic}
              title={isListening ? "音声入力を停止" : "音声入力"}
              className={`flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-full transition-all active:scale-90 ${
                isListening
                  ? "bg-red-500 text-white animate-pulse"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-600"
              }`}
            >
              🎤
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isListening ? "話してください...(もう一度🎤で停止)" : "相談したいことを入力..."}
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
              className="flex-shrink-0 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 active:scale-95 text-white rounded-xl text-sm font-medium transition-all"
            >
              {streaming ? "..." : "送信"}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-full shadow-lg z-20">
          {toast}
        </div>
      )}
    </div>
  );
}
