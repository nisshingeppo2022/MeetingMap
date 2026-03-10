"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface Meeting {
  id: string;
  contact: { name: string; organization: string | null } | null;
}

export default function RecallPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [listening, setListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch(`/api/meetings/${id}`)
      .then((r) => r.json())
      .then(setMeeting);
  }, [id]);

  function toggleVoiceInput() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;

    if (!SR) {
      alert("このブラウザは音声入力に対応していません");
      return;
    }

    const recognition = new SR();
    recognition.lang = "ja-JP";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    let interim = "";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          setNotes((prev) => prev + event.results[i][0].transcript);
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      void interim;
    };

    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognition.start();
    setListening(true);
  }

  async function handleSubmit() {
    if (!notes.trim()) return;
    setSaving(true);
    recognitionRef.current?.stop();
    await fetch(`/api/meetings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: notes.trim(),
        status: "processing",
      }),
    });
    router.push(`/meetings/${id}/result?autoAnalyze=1`);
  }

  if (!meeting) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-xl">←</Link>
          <div className="flex-1">
            <h1 className="text-base font-bold text-gray-800">振り返り入力</h1>
            {meeting.contact && (
              <p className="text-xs text-gray-400">{meeting.contact.name}</p>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-4 py-6 gap-4">
        <p className="text-sm text-gray-500">
          ミーティングで話した内容をメモしてください。AIが自動でマインドマップを作成します。
        </p>

        <div className="relative flex-1 flex flex-col">
          <textarea
            ref={textareaRef}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={`例：
・新製品の発売時期について話し合った
・価格は5万円前後を想定
・田中さんが来週までにサンプルを用意する
・次回は3月末に再度打ち合わせ`}
            className="flex-1 w-full min-h-64 px-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none shadow-sm leading-relaxed"
            autoFocus
          />

          {listening && (
            <div className="absolute bottom-3 left-3 right-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-red-600 font-medium">音声入力中... 話してください</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{notes.length}文字</span>
            <button
              onClick={toggleVoiceInput}
              className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl transition-colors ${
                listening
                  ? "bg-red-100 text-red-600 hover:bg-red-200"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {listening ? "🛑 停止" : "🎙️ 音声入力"}
            </button>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!notes.trim() || saving}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold px-8 py-3 rounded-2xl transition-colors shadow-sm text-sm"
          >
            {saving ? "保存中..." : "📝 保存してAI分析へ"}
          </button>
        </div>
      </main>
    </div>
  );
}
