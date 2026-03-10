"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

interface Meeting {
  id: string;
  mode: string;
  contact: { name: string; organization: string | null } | null;
}

interface StarredNode {
  id: string;
  label: string;
  nodeType: string;
  meetingId: string;
  meetingTitle: string | null;
  meetingDate: string;
}

interface MatchedNode extends StarredNode {
  matchedKeywords: string[];
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// クロスリンクAPIと同じストップワード・トークナイザー
const STOP_WORDS = new Set([
  "の","に","は","を","が","で","と","や","へ","も","か","な","ず","て","し",
  "から","まで","より","ので","のに","けど","との","での","への","には","では",
  "とは","ても","でも","など","ため","ほど","だけ","しか","について","として",
  "これ","それ","あれ","この","その","あの","こと","もの","ところ","とき","ここ",
  "する","した","して","します","ない","ある","いる","なる","れる","られ","せる",
  "させ","という","として","ている","です","ます","であ","ので","のに","だけ",
  "こと","もの","場合","方法","状況","内容","関連","活用","利用","使用",
  "a","an","the","is","are","was","of","in","to","for","and","or","with","by",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\u3000、。・,.!?！？「」【】『』（）()\-_/\\：:・〜～]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function matchNodes(transcript: string, starredNodes: StarredNode[]): MatchedNode[] {
  if (!transcript.trim() || starredNodes.length === 0) return [];

  const transcriptLower = transcript.toLowerCase();
  const transcriptTokens = new Set(tokenize(transcript));
  const matched: MatchedNode[] = [];
  const seenIds = new Set<string>();

  for (const node of starredNodes) {
    if (seenIds.has(node.id)) continue;
    const nodeTokens = tokenize(node.label);
    const nodeLabelLower = node.label.toLowerCase();

    const keywords: string[] = [];
    for (const w of nodeTokens) {
      if (transcriptTokens.has(w)) {
        keywords.push(w);
      } else if (w.length >= 4 && transcriptLower.includes(w)) {
        keywords.push(w);
      }
    }
    // ノードラベルそのものがトランスクリプトに含まれる場合（3文字以上）
    if (keywords.length === 0 && nodeLabelLower.length >= 3 && transcriptLower.includes(nodeLabelLower)) {
      keywords.push(node.label);
    }

    if (keywords.length > 0) {
      seenIds.add(node.id);
      matched.push({ ...node, matchedKeywords: keywords });
    }
  }

  return matched;
}

export default function RecordPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [started, setStarted] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [starredNodes, setStarredNodes] = useState<StarredNode[]>([]);
  const [matches, setMatches] = useState<MatchedNode[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const matchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    isRecording, isPaused, audioBlob, elapsedSeconds,
    start: startRecording, pause: pauseRecording, resume: resumeRecording, stop: stopRecording,
  } = useAudioRecorder();
  const { segments, isSupported, start: startSpeech, stop: stopSpeech, fullTranscript } = useSpeechRecognition();

  useEffect(() => {
    fetch(`/api/meetings/${id}`)
      .then((r) => r.json())
      .then(setMeeting);
    // 星付き候補ノードを取得
    fetch("/api/mindmap/starred")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setStarredNodes(data); });
  }, [id]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [segments]);

  // 文字起こしが更新されるたびにデバウンスでマッチング
  const runMatch = useCallback((transcript: string) => {
    if (matchTimerRef.current) clearTimeout(matchTimerRef.current);
    matchTimerRef.current = setTimeout(() => {
      const result = matchNodes(transcript, starredNodes);
      setMatches(result);
    }, 2000);
  }, [starredNodes]);

  useEffect(() => {
    if (!started || !fullTranscript) return;
    runMatch(fullTranscript);
  }, [fullTranscript, started, runMatch]);

  const fullTranscriptRef = useRef(fullTranscript);
  const segmentsRef = useRef(segments);
  const elapsedSecondsRef = useRef(elapsedSeconds);
  useEffect(() => { fullTranscriptRef.current = fullTranscript; }, [fullTranscript]);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);
  useEffect(() => { elapsedSecondsRef.current = elapsedSeconds; }, [elapsedSeconds]);

  useEffect(() => {
    if (!audioBlob || !stopping) return;
    async function finalize() {
      await fetch(`/api/meetings/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: fullTranscriptRef.current,
          transcriptSegments: segmentsRef.current,
          durationSeconds: elapsedSecondsRef.current,
          status: "processing",
        }),
      });
      router.push(`/meetings/${id}/result`);
    }
    finalize();
  }, [audioBlob, stopping, id, router]);

  function handleStart() {
    startRecording();
    if (isSupported) startSpeech();
    setStarted(true);
  }

  function handlePause() {
    pauseRecording();
    stopSpeech();
  }

  function handleResume() {
    resumeRecording();
    if (isSupported) startSpeech();
  }

  function handleStop() {
    setStopping(true);
    stopSpeech();
    stopRecording();
    if (matchTimerRef.current) clearTimeout(matchTimerRef.current);
  }

  if (!meeting) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <p className="text-gray-500 text-sm">読み込み中...</p>
      </div>
    );
  }

  const statusLabel = isPaused ? "一時停止中" : isRecording ? "録音中" : started ? "処理中..." : "準備中";
  const statusColor = isPaused ? "bg-yellow-500" : "bg-red-500 animate-pulse";

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* ヘッダー */}
      <header className="px-4 pt-6 pb-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              {started && !stopping && (
                <span className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
              )}
              <span className="text-white font-medium text-sm">{statusLabel}</span>
            </div>
            <span className="text-white font-mono text-lg font-bold">
              {formatTime(elapsedSeconds)}
            </span>
          </div>
          {meeting.contact && (
            <p className="text-gray-400 text-sm">
              {meeting.contact.name}
              {meeting.contact.organization && ` · ${meeting.contact.organization}`}
            </p>
          )}
        </div>
      </header>

      {/* 文字起こしエリア */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        <div className="max-w-2xl mx-auto space-y-3">
          {!isSupported && (
            <div className="bg-yellow-900/50 border border-yellow-700 rounded-xl p-3 text-yellow-300 text-sm">
              ⚠️ このブラウザは音声認識に対応していません。Chrome または Edge をお使いください。
            </div>
          )}
          {!started && (
            <p className="text-gray-500 text-sm text-center py-8">
              下のボタンで録音を開始してください
            </p>
          )}
          {segments.length === 0 && started && !stopping && (
            <p className="text-gray-500 text-sm text-center py-8">
              {isPaused ? "一時停止中です" : "話しかけると文字起こしが表示されます..."}
            </p>
          )}
          {segments.map((seg, i) => (
            <div key={i} className="bg-gray-800 rounded-xl px-4 py-3">
              <p className="text-white text-sm leading-relaxed">{seg.text}</p>
              <p className="text-gray-500 text-xs mt-1">
                {new Date(seg.timestamp).toLocaleTimeString("ja-JP", {
                  hour: "2-digit", minute: "2-digit", second: "2-digit",
                })}
              </p>
            </div>
          ))}
          <div ref={transcriptEndRef} />
        </div>
      </div>

      {/* 関連する過去の議題パネル */}
      {started && starredNodes.length > 0 && (
        <div className="px-4 pb-2">
          <div className="max-w-2xl mx-auto">
            <button
              onClick={() => setPanelOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 bg-indigo-900/60 rounded-xl text-xs text-indigo-300 font-medium"
            >
              <span>
                関連する過去の議題
                {matches.length > 0 && (
                  <span className="ml-2 bg-indigo-500 text-white rounded-full px-1.5 py-0.5">
                    {matches.length}件
                  </span>
                )}
              </span>
              <span>{panelOpen ? "▲" : "▼"}</span>
            </button>

            {panelOpen && (
              <div className="mt-1 bg-gray-800/80 rounded-xl overflow-hidden">
                {matches.length === 0 ? (
                  <p className="text-gray-500 text-xs text-center py-3">
                    {fullTranscript ? "一致する過去の議題はありません" : "話しかけると関連する過去の議題を表示します"}
                  </p>
                ) : (
                  <div className="divide-y divide-gray-700/50 max-h-40 overflow-y-auto">
                    {matches.map((m) => (
                      <div key={m.id} className="px-3 py-2 flex items-start gap-2">
                        <span className="text-indigo-400 text-xs mt-0.5 flex-shrink-0">⭐</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-xs font-medium truncate">{m.label}</p>
                          <p className="text-gray-400 text-xs truncate">
                            {m.meetingTitle ?? "無題"} ·{" "}
                            {new Date(m.meetingDate).toLocaleDateString("ja-JP", { month: "short", day: "numeric" })}
                          </p>
                          <p className="text-indigo-400 text-xs mt-0.5">
                            一致: {m.matchedKeywords.slice(0, 3).join("・")}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* コントロールボタン */}
      <div className="px-4 pb-8 pt-2">
        <div className="max-w-2xl mx-auto space-y-3">
          {!started ? (
            <button
              onClick={handleStart}
              className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-5 rounded-2xl transition-colors text-base shadow-lg"
            >
              🎙️ 録音開始
            </button>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={isPaused ? handleResume : handlePause}
                disabled={stopping}
                className={`flex-1 font-semibold py-4 rounded-2xl transition-colors text-sm disabled:opacity-40 ${
                  isPaused
                    ? "bg-green-600 hover:bg-green-500 text-white"
                    : "bg-yellow-500 hover:bg-yellow-400 text-white"
                }`}
              >
                {isPaused ? "▶ 再開" : "⏸ 一時停止"}
              </button>
              <button
                onClick={handleStop}
                disabled={stopping}
                className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white font-semibold py-4 rounded-2xl transition-colors text-sm"
              >
                {stopping ? "保存中..." : "⏹ 停止"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
