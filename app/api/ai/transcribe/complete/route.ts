import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

function normalizeMime(mimeType: string, storagePath: string): string {
  const name = storagePath.toLowerCase();
  if (name.endsWith(".m4a") || name.endsWith(".caf")) return "audio/mp4";
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".ogg")) return "audio/ogg";
  if (name.endsWith(".aac")) return "audio/aac";
  if (name.endsWith(".flac")) return "audio/flac";
  if (name.endsWith(".webm")) return "audio/webm";
  if (mimeType === "audio/x-m4a" || mimeType === "audio/m4a") return "audio/mp4";
  return mimeType || "audio/mp4";
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { storagePath, mimeType, meetingId, append } = await request.json();
    if (!storagePath || !meetingId) {
      return NextResponse.json({ error: "storagePath と meetingId は必須です" }, { status: 400 });
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // Supabase Storageからファイルをダウンロード
    console.log(`Downloading from storage: ${storagePath}`);
    const { data: fileBlob, error: downloadError } = await admin.storage
      .from("audio-uploads")
      .download(storagePath);

    if (downloadError || !fileBlob) {
      return NextResponse.json({ error: `ファイルのダウンロードに失敗: ${downloadError?.message}` }, { status: 500 });
    }

    const fileSize = fileBlob.size;
    const normalizedMime = normalizeMime(mimeType ?? "", storagePath);
    const fileName = storagePath.split("/").pop() ?? "audio";
    console.log(`Downloaded: ${(fileSize / 1024 / 1024).toFixed(1)}MB, mime: ${normalizedMime}`);

    const apiKey = process.env.GEMINI_API_KEY!;

    // Gemini Files API にアップロード（resumable）
    const initRes = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(fileSize),
          "X-Goog-Upload-Header-Content-Type": normalizedMime,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file: { display_name: fileName } }),
      }
    );

    if (!initRes.ok) {
      const err = await initRes.text();
      return NextResponse.json({ error: `Geminiアップロード初期化失敗: ${err.slice(0, 200)}` }, { status: 500 });
    }

    const uploadUrl = initRes.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      return NextResponse.json({ error: "アップロードURLが取得できませんでした" }, { status: 500 });
    }

    // Geminiにファイルをアップロード
    console.log("Uploading to Gemini...");
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length": String(fileSize),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: fileBlob as any,
      duplex: "half",
    } as RequestInit);

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return NextResponse.json({ error: `Geminiアップロード失敗: ${err.slice(0, 200)}` }, { status: 500 });
    }

    const uploadData = await uploadRes.json();
    const fileUri = uploadData.file?.uri;
    if (!fileUri) {
      return NextResponse.json({ error: "ファイルURIが取得できませんでした" }, { status: 500 });
    }

    // 文字起こし
    console.log("Transcribing...");
    const transcribeRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { file_data: { mime_type: normalizedMime, file_uri: fileUri } },
              { text: "この音声を文字起こしてください。話者が複数いる場合は区別して、できるだけ正確に日本語で出力してください。文字起こしのみを出力してください。" },
            ],
          }],
          generationConfig: { temperature: 0 },
        }),
      }
    );

    if (!transcribeRes.ok) {
      const err = await transcribeRes.text();
      return NextResponse.json({ error: `文字起こし失敗 (${transcribeRes.status}): ${err.slice(0, 200)}` }, { status: 500 });
    }

    const transcribeData = await transcribeRes.json();
    const newTranscript = transcribeData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    console.log(`Transcript: ${newTranscript.length} chars`);

    // append=true の場合、既存のtranscriptに追記
    let finalTranscript = newTranscript;
    if (append) {
      const existing = await prisma.meeting.findFirst({
        where: { id: meetingId, userId: user.id },
        select: { transcript: true },
      });
      if (existing?.transcript) {
        finalTranscript = existing.transcript + "\n\n" + newTranscript;
      }
    }

    await prisma.meeting.updateMany({
      where: { id: meetingId, userId: user.id },
      data: { transcript: finalTranscript, status: "processing" },
    });

    // 使い終わったファイルをStorageから削除
    await admin.storage.from("audio-uploads").remove([storagePath]);

    return NextResponse.json({ success: true, transcript: finalTranscript });

  } catch (e) {
    console.error("Transcribe complete error:", e);
    return NextResponse.json({ error: `エラー: ${(e as Error).message}` }, { status: 500 });
  }
}
