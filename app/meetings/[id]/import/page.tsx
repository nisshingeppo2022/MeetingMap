"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface Meeting {
  id: string;
  contact: { name: string; organization: string | null } | null;
}

type Step = "select" | "uploading" | "transcribing" | "done" | "error";

const ACCEPTED = ".m4a,.mp3,.mp4,.wav,.aac,.ogg,.flac,.webm,.caf";

export default function ImportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("select");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/meetings/${id}`)
      .then((r) => r.json())
      .then(setMeeting);
  }, [id]);

  async function handleUpload() {
    if (!file) return;

    try {
      setStep("uploading");
      setUploadProgress(0);

      // XHRでアップロード進捗を表示しながらサーバーに送る
      const fileUri = await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        formData.append("file", file);
        formData.append("meeting_id", id);

        xhr.open("POST", "/api/ai/transcribe");

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(pct);
            if (pct >= 100) setStep("transcribing");
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            try {
              const data = JSON.parse(xhr.responseText);
              reject(new Error(data.error ?? `サーバーエラー (${xhr.status})`));
            } catch {
              reject(new Error(`サーバーエラー (${xhr.status})`));
            }
          }
        };

        xhr.onerror = () => reject(new Error("ネットワークエラーが発生しました"));
        xhr.send(formData);
      });

      void fileUri;
      setStep("done");
      router.push(`/meetings/${id}/result?autoAnalyze=1`);

    } catch (e) {
      console.error(e);
      setErrorMsg((e as Error).message);
      setStep("error");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-xl">←</Link>
          <div className="flex-1">
            <h1 className="text-base font-bold text-gray-800">音声を取り込む</h1>
            {meeting?.contact && (
              <p className="text-xs text-gray-400">{meeting.contact.name}</p>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 space-y-6">
        {step === "select" && (
          <>
            <div className="bg-indigo-50 rounded-2xl p-4 text-sm text-indigo-700 space-y-2">
              <p className="font-semibold">iPhoneのボイスメモから取り込む方法</p>
              <ol className="list-decimal list-inside space-y-1 text-indigo-600 text-xs">
                <li>ボイスメモアプリで録音を長押し →「共有」</li>
                <li>AirDrop でMacに送る、またはiCloud Drive経由でMacに保存</li>
                <li>下のボタンからファイルを選択</li>
              </ol>
              <p className="text-xs text-indigo-500">※ 1時間以上の長い録音も対応しています</p>
            </div>

            <button
              onClick={() => inputRef.current?.click()}
              className="w-full flex flex-col items-center gap-3 bg-white border-2 border-dashed border-gray-200 rounded-2xl p-10 hover:border-indigo-300 transition-colors"
            >
              <span className="text-5xl">📂</span>
              <div className="text-center">
                <p className="font-medium text-gray-700 text-sm">音声ファイルを選択</p>
                <p className="text-xs text-gray-400 mt-1">M4A・MP3・WAV・MP4など対応</p>
              </div>
            </button>

            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />

            {file && (
              <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm flex items-center gap-3">
                <span className="text-2xl">🎵</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
                  <p className="text-xs text-gray-400">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>
                <button onClick={() => setFile(null)} className="text-gray-300 hover:text-gray-500">✕</button>
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={!file}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold py-4 rounded-2xl transition-colors shadow-sm text-sm"
            >
              🤖 文字起こし＆AI分析する
            </button>
          </>
        )}

        {step === "uploading" && (
          <div className="flex flex-col items-center justify-center py-16 gap-5">
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-indigo-500 h-3 rounded-full transition-all duration-500"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <div className="text-center">
              <p className="text-gray-700 font-semibold text-sm">サーバーにアップロード中... {uploadProgress}%</p>
              {file && <p className="text-gray-400 text-xs mt-1">{file.name}（{(file.size / 1024 / 1024).toFixed(1)} MB）</p>}
              <p className="text-amber-500 text-xs mt-3 font-medium">このページを閉じないでください</p>
            </div>
          </div>
        )}

        {step === "transcribing" && (
          <div className="flex flex-col items-center justify-center py-16 gap-5">
            <div className="w-16 h-16 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
            <div className="text-center">
              <p className="text-gray-700 font-semibold text-sm">AIが文字起こし中...</p>
              <p className="text-gray-400 text-xs mt-1">1時間以上の音声は数分かかります</p>
              <p className="text-amber-500 text-xs mt-3 font-medium">このページを閉じないでください</p>
            </div>
          </div>
        )}

        {step === "error" && (
          <div className="bg-red-50 rounded-2xl p-6 text-center space-y-3">
            <p className="text-red-600 font-medium text-sm">{errorMsg}</p>
            <button
              onClick={() => { setStep("select"); setFile(null); setUploadProgress(0); }}
              className="text-sm text-indigo-600 underline"
            >
              もう一度試す
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
