import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

function normalizeMime(rawMime: string, fileName: string): string {
  if (fileName.endsWith(".m4a") || fileName.endsWith(".caf")) return "audio/mp4";
  if (fileName.endsWith(".mp3")) return "audio/mpeg";
  if (fileName.endsWith(".wav")) return "audio/wav";
  if (fileName.endsWith(".ogg")) return "audio/ogg";
  if (fileName.endsWith(".aac")) return "audio/aac";
  if (fileName.endsWith(".flac")) return "audio/flac";
  if (fileName.endsWith(".webm")) return "audio/webm";
  if (rawMime === "audio/x-m4a" || rawMime === "audio/m4a") return "audio/mp4";
  return rawMime || "audio/mp4";
}

async function uploadToGemini(file: File, mimeType: string, apiKey: string): Promise<string> {
  const fileSize = file.size;
  console.log(`Uploading ${file.name} (${(fileSize/1024/1024).toFixed(1)}MB, ${mimeType}) to Gemini...`);

  // 1. Resumable upload を開始してURLを取得
  const initRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(fileSize),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: file.name } }),
    }
  );

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`Upload init failed (${initRes.status}): ${err.slice(0, 200)}`);
  }

  const uploadUrl = initRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Upload URL not returned");

  // 2. Fileオブジェクトをそのままストリームで送信（メモリに全ロードしない）
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(fileSize),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: file as any,
    duplex: "half",
  } as RequestInit);

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Upload failed (${uploadRes.status}): ${err.slice(0, 200)}`);
  }

  const data = await uploadRes.json();
  const uri = data.file?.uri;
  if (!uri) throw new Error("File URI not in response");
  console.log("Uploaded:", uri);
  return uri;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (e) {
      console.error("FormData error:", e);
      return NextResponse.json({ error: "ファイルの読み込みに失敗しました" }, { status: 400 });
    }

    const file = formData.get("file") as File | null;
    const meetingId = formData.get("meeting_id") as string | null;
    if (!file || !meetingId) {
      return NextResponse.json({ error: "file と meeting_id は必須です" }, { status: 400 });
    }

    const mimeType = normalizeMime(file.type, file.name);
    console.log(`Transcribe request: ${file.name}, ${(file.size/1024/1024).toFixed(1)}MB, ${mimeType}`);

    const apiKey = process.env.GEMINI_API_KEY!;

    // Gemini にアップロード（ストリーム送信）
    let fileUri: string;
    try {
      fileUri = await uploadToGemini(file, mimeType, apiKey);
    } catch (e) {
      return NextResponse.json({ error: `アップロード失敗: ${(e as Error).message}` }, { status: 500 });
    }

    // 文字起こし
    console.log("Starting transcription...");
    const transcribeRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { file_data: { mime_type: mimeType, file_uri: fileUri } },
              { text: "この音声を文字起こしてください。話者が複数いる場合は区別して、できるだけ正確に日本語で出力してください。文字起こしのみを出力してください。" },
            ],
          }],
          generationConfig: { temperature: 0 },
        }),
      }
    );

    if (!transcribeRes.ok) {
      const err = await transcribeRes.text();
      console.error("Transcribe error:", transcribeRes.status, err);
      return NextResponse.json({ error: `文字起こし失敗 (${transcribeRes.status}): ${err.slice(0, 200)}` }, { status: 500 });
    }

    const transcribeData = await transcribeRes.json();
    const transcript = transcribeData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    console.log(`Transcript: ${transcript.length} chars`);

    await prisma.meeting.updateMany({
      where: { id: meetingId, userId: user.id },
      data: { transcript, status: "processing" },
    });

    return NextResponse.json({ success: true, transcript });

  } catch (e) {
    console.error("Unexpected error:", e);
    return NextResponse.json({ error: `エラー: ${(e as Error).message}` }, { status: 500 });
  }
}
