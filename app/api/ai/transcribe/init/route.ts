import { createServerSupabaseClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

// ブラウザから直接Geminiにアップロードするための初期化エンドポイント
// ファイルはVercelを経由しないため、サイズ制限なし
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { fileName, fileSize, mimeType } = await request.json();
  if (!fileName || !fileSize || !mimeType) {
    return NextResponse.json({ error: "fileName, fileSize, mimeType は必須です" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY!;

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
      body: JSON.stringify({ file: { display_name: fileName } }),
    }
  );

  if (!initRes.ok) {
    const err = await initRes.text();
    return NextResponse.json({ error: `アップロード初期化失敗: ${err.slice(0, 200)}` }, { status: 500 });
  }

  const uploadUrl = initRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    return NextResponse.json({ error: "アップロードURLが取得できませんでした" }, { status: 500 });
  }

  return NextResponse.json({ uploadUrl });
}
