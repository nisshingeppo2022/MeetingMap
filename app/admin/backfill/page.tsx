"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface UntaggedMeeting {
  id: string;
  title: string | null;
  date: string;
}

interface FailedMeeting extends UntaggedMeeting {
  status: number | null;
  message: string;
}

async function runOne(meetingId: string): Promise<{ ok: boolean; status: number | null; message: string }> {
  try {
    const res = await fetch("/api/ai/backfill-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting_id: meetingId }),
    });
    if (res.ok) return { ok: true, status: res.status, message: "" };
    const text = await res.text();
    let message = text;
    try {
      const data = JSON.parse(text);
      message = data.error ?? text;
    } catch {
      // JSONでない場合(プラットフォーム側のタイムアウトページ等)はそのまま表示
    }
    return { ok: false, status: res.status, message: message.slice(0, 300) };
  } catch (e) {
    return { ok: false, status: null, message: (e as Error).message || "ネットワークエラー" };
  }
}

export default function BackfillPage() {
  const [meetings, setMeetings] = useState<UntaggedMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState<FailedMeeting[]>([]);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/ai/backfill-tags");
    const data = await res.json();
    setMeetings(data.meetings ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function runAll() {
    setRunning(true);
    setProgress(0);
    setErrors([]);
    const targets = meetings;
    const failed: FailedMeeting[] = [];
    for (let i = 0; i < targets.length; i++) {
      const result = await runOne(targets[i].id);
      if (!result.ok) {
        failed.push({ ...targets[i], status: result.status, message: result.message });
      }
      setProgress(i + 1);
      // Geminiのレート制限に配慮して次のリクエストまで少し間隔を空ける
      if (i < targets.length - 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    setErrors(failed);
    setRunning(false);
    await load();
  }

  async function retryOne(meeting: FailedMeeting) {
    const result = await runOne(meeting.id);
    if (result.ok) {
      setErrors((prev) => prev.filter((e) => e.id !== meeting.id));
      await load();
    } else {
      setErrors((prev) =>
        prev.map((e) =>
          e.id === meeting.id ? { ...e, status: result.status, message: result.message } : e
        )
      );
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-xl">←</Link>
          <h1 className="text-base font-bold text-gray-800">タグ一括付与</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {loading ? (
          <p className="text-sm text-gray-400">読み込み中...</p>
        ) : (
          <>
            <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
              <p className="text-sm text-gray-700">タグ未付与の会議: {meetings.length}件</p>
            </div>

            {meetings.length > 0 && (
              <button
                onClick={runAll}
                disabled={running}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold py-4 rounded-2xl transition-colors shadow-sm text-sm"
              >
                {running ? `処理中... ${progress}/${meetings.length} 完了` : "一括実行"}
              </button>
            )}

            {errors.length > 0 && (
              <div className="bg-red-50 rounded-2xl p-4 space-y-3">
                <p className="text-sm text-red-600 font-medium">失敗した会議({errors.length}件)</p>
                {errors.map((e) => (
                  <div key={e.id} className="border-t border-red-100 pt-2 first:border-t-0 first:pt-0 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-gray-700 truncate">{e.title ?? "タイトルなし"}</span>
                      <button
                        onClick={() => retryOne(e)}
                        className="text-indigo-600 underline text-xs flex-shrink-0"
                      >
                        再試行
                      </button>
                    </div>
                    <p className="text-xs text-red-500 break-words">
                      {e.status !== null ? `HTTP ${e.status}: ` : ""}
                      {e.message}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
