import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

// ブラウザがSupabase Storageに直接アップロードするための署名付きURLを発行
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { fileName, fileIndex } = await request.json();
  if (!fileName) {
    return NextResponse.json({ error: "fileName は必須です" }, { status: 400 });
  }

  // service_role でストレージ操作
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // ファイル名の拡張子だけ取り出し、パスは安全な文字のみ使用
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "audio";
  const storagePath = `${user.id}/${Date.now()}_${fileIndex ?? 0}.${ext}`;

  const { data, error } = await admin.storage
    .from("audio-uploads")
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    console.error("Supabase signed URL error:", error);
    return NextResponse.json({ error: `ストレージURLの取得に失敗しました: ${error?.message}` }, { status: 500 });
  }

  return NextResponse.json({ signedUploadUrl: data.signedUrl, storagePath });
}
