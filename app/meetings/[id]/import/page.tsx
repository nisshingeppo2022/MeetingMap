"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";

interface Meeting {
  id: string;
  contact: { name: string; organization: string | null } | null;
}

type Step = "select" | "processing" | "done" | "error";

const ACCEPTED = ".m4a,.mp3,.mp4,.wav,.aac,.ogg,.flac,.webm,.caf";

export default function ImportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [step, setStep] = useState<Step>("select");
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/meetings/${id}`)
      .then((r) => r.json())
      .then(setMeeting);
  }, [id]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    selected.sort((a, b) => a.name.localeCompare(b.name));
    setFiles(selected);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function processFile(file: File, fileIndex: number, isFirst: boolean): Promise<void> {
    const supabase = createClient();

    // ユーザー情報とJWT取得
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("ログインが必要です");

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "audio";
    const storagePath = `${session.user.id}/${Date.now()}_${fileIndex}.${ext}`;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

    // Step 1: Supabase StorageにXHRで直接アップロード（進捗表示あり）
    setStatusMsg(`ファイル ${fileIndex + 1}/${files.length}：Supabaseにアップロード中...`);
    setUploadProgress(0);

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${supabaseUrl}/storage/v1/object/audio-uploads/${storagePath}`);
      xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("x-upsert", "true");

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`アップロード失敗 (${xhr.status}): ${xhr.responseText.slice(0, 150)}`));
        }
      };
      xhr.onerror = () => reject(new Error("ネットワークエラーが発生しました"));
      xhr.send(file);
    });

    // Step 2: サーバーがStorageからダウンロードしてGeminiで文字起こし
    setStatusMsg(`ファイル ${fileIndex + 1}/${files.length}：AIが文字起こし中...`);
    setUploadProgress(100);

    const completeRes = await fetch("/api/ai/transcribe/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storagePath,
        mimeType: file.type,
        meetingId: id,
        append: !isFirst,
      }),
    });
    if (!completeRes.ok) {
      const data = await completeRes.json().catch(() => ({}));
      throw new Error(data.error ?? `文字起こし失敗 (${completeRes.status})`);
    }
  }

  async function handleUpload() {
    if (files.length === 0) return;
    setStep("processing");
    setCurrentFileIndex(0);
    setUploadProgress(0);

    try {
      for (let i = 0; i < files.length; i++) {
        setCurrentFileIndex(i);
        await processFile(files[i], i, i === 0);
      }
      setStep("done");
      router.push(`/meetings/${id}/result?autoAnalyze=1`);
    } catch (e) {
      console.error(e);
      setErrorMsg((e as Error).message);
      setStep("error");
    }
  }

  const totalSizeMB = files.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024;

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
              <p className="font-semibold">音声ファイルの取り込みについて</p>
              <ul className="list-disc list-inside space-y-1 text-indigo-600 text-xs">
                <li>2時間以上の長い録音も対応（ファイルサイズ制限なし）</li>
                <li>分割した音声は複数同時に選択できます。名前順に結合されます</li>
                <li>M4A・MP3・WAV・MP4・AAC・OGG・WEBMなど対応</li>
              </ul>
            </div>

            <button
              onClick={() => inputRef.current?.click()}
              className="w-full flex flex-col items-center gap-3 bg-white border-2 border-dashed border-gray-200 rounded-2xl p-10 hover:border-indigo-300 transition-colors"
            >
              <span className="text-5xl">📂</span>
              <div className="text-center">
                <p className="font-medium text-gray-700 text-sm">音声ファイルを選択</p>
                <p className="text-xs text-gray-400 mt-1">複数ファイルを同時に選択できます</p>
              </div>
            </button>

            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED}
              multiple
              className="hidden"
              onChange={handleFileChange}
            />

            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((file, i) => (
                  <div key={i} className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm flex items-center gap-3">
                    <span className="text-sm text-gray-400 font-bold min-w-[1.5rem] text-center">{i + 1}</span>
                    <span className="text-lg">🎵</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
                      <p className="text-xs text-gray-400">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                    </div>
                    <button onClick={() => removeFile(i)} className="text-gray-300 hover:text-gray-500 text-sm">✕</button>
                  </div>
                ))}
                {files.length > 1 && (
                  <p className="text-xs text-gray-400 text-center">
                    合計 {totalSizeMB.toFixed(1)} MB · {files.length}ファイルを順番に結合します
                  </p>
                )}
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={files.length === 0}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold py-4 rounded-2xl transition-colors shadow-sm text-sm"
            >
              🤖 文字起こし＆AI分析する
            </button>
          </>
        )}

        {step === "processing" && (
          <div className="flex flex-col items-center justify-center py-16 gap-5">
            {files.length > 1 && (
              <div className="flex gap-1.5">
                {files.map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 rounded-full transition-all ${
                      i < currentFileIndex ? "w-4 bg-indigo-400" :
                      i === currentFileIndex ? "w-8 bg-indigo-600" :
                      "w-4 bg-gray-200"
                    }`}
                  />
                ))}
              </div>
            )}
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-indigo-500 h-3 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <div className="text-center space-y-1">
              <p className="text-gray-700 font-semibold text-sm">{statusMsg}</p>
              {files[currentFileIndex] && (
                <p className="text-gray-400 text-xs">
                  {files[currentFileIndex].name}（{(files[currentFileIndex].size / 1024 / 1024).toFixed(1)} MB）
                </p>
              )}
              {uploadProgress === 100 && (
                <p className="text-indigo-500 text-xs">文字起こしは数分かかることがあります...</p>
              )}
              <p className="text-amber-500 text-xs font-medium pt-1">このページを閉じないでください</p>
            </div>
          </div>
        )}

        {step === "error" && (
          <div className="bg-red-50 rounded-2xl p-6 text-center space-y-3">
            <p className="text-red-600 font-medium text-sm">{errorMsg}</p>
            <button
              onClick={() => { setStep("select"); setFiles([]); setUploadProgress(0); }}
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
