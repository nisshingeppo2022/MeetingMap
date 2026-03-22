import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { fileUri, meetingId, mimeType, append } = await request.json();
    if (!fileUri || !meetingId || !mimeType) {
      return NextResponse.json({ error: "fileUri, meetingId, mimeType は必須です" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY!;

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
      return NextResponse.json({ error: `文字起こし失敗 (${transcribeRes.status}): ${err.slice(0, 200)}` }, { status: 500 });
    }

    const transcribeData = await transcribeRes.json();
    const newTranscript = transcribeData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

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

    return NextResponse.json({ success: true, transcript: finalTranscript });

  } catch (e) {
    console.error("Transcribe complete error:", e);
    return NextResponse.json({ error: `エラー: ${(e as Error).message}` }, { status: 500 });
  }
}
