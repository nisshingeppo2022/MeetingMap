import { createServerSupabaseClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const BUCKET = "business-cards";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "ファイルの読み込みに失敗しました" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "fileは必須です" }, { status: 400 });

  const apiKey = process.env.GEMINI_API_KEY!;
  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const mimeType = file.type || "image/jpeg";
  const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";

  // 1. Supabase Storage にアップロード
  let cardUrl: string | null = null;
  const storagePath = `${user.id}/${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, Buffer.from(bytes), { contentType: mimeType, upsert: false });

  if (!uploadError) {
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    cardUrl = urlData.publicUrl;
  } else {
    console.warn("Storage upload failed:", uploadError.message);
  }

  // 2. Gemini Vision で OCR
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            {
              text: `この名刺画像から情報を読み取り、以下のJSON形式で出力してください。存在しない項目は空文字にしてください。
{
  "name": "氏名（フルネーム）",
  "organization": "会社・組織名",
  "position": "役職",
  "email": "メールアドレス",
  "phone": "電話番号（代表的なもの1つ）"
}
JSONのみを出力してください。`,
            },
          ],
        }],
        generationConfig: { temperature: 0 },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `OCR失敗: ${err.slice(0, 200)}` }, { status: 500 });
  }

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return NextResponse.json({ error: "解析結果を取得できませんでした" }, { status: 500 });

  try {
    const parsed = JSON.parse(match[0]);
    return NextResponse.json({ ...parsed, cardUrl });
  } catch {
    return NextResponse.json({ error: "JSON解析に失敗しました" }, { status: 500 });
  }
}
