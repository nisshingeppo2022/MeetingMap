import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeMime(mimeType: string, path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".m4a") || p.endsWith(".caf")) return "audio/mp4";
  if (p.endsWith(".mp3")) return "audio/mpeg";
  if (p.endsWith(".wav")) return "audio/wav";
  if (p.endsWith(".ogg")) return "audio/ogg";
  if (p.endsWith(".aac")) return "audio/aac";
  if (p.endsWith(".flac")) return "audio/flac";
  if (p.endsWith(".webm")) return "audio/webm";
  if (mimeType === "audio/x-m4a" || mimeType === "audio/m4a") return "audio/mp4";
  return mimeType || "audio/mp4";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // JWT検証
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: corsHeaders,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY")!;

    // ユーザー認証確認
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: corsHeaders,
      });
    }

    const { storagePath, mimeType } = await req.json();
    if (!storagePath) {
      return new Response(JSON.stringify({ error: "storagePath は必須です" }), {
        status: 400, headers: corsHeaders,
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Supabase Storageからダウンロード
    console.log(`Downloading: ${storagePath}`);
    const { data: fileBlob, error: downloadError } = await admin.storage
      .from("audio-uploads")
      .download(storagePath);

    if (downloadError || !fileBlob) {
      return new Response(JSON.stringify({ error: `ダウンロード失敗: ${downloadError?.message}` }), {
        status: 500, headers: corsHeaders,
      });
    }

    const fileSize = fileBlob.size;
    const normalizedMime = normalizeMime(mimeType ?? "", storagePath);
    const fileName = storagePath.split("/").pop() ?? "audio";
    console.log(`Downloaded: ${(fileSize / 1024 / 1024).toFixed(1)}MB, ${normalizedMime}`);

    // Gemini Files API にアップロード（resumable）
    const initRes = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${geminiApiKey}`,
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
      return new Response(JSON.stringify({ error: `Geminiアップロード初期化失敗: ${err.slice(0, 200)}` }), {
        status: 500, headers: corsHeaders,
      });
    }

    const uploadUrl = initRes.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      return new Response(JSON.stringify({ error: "アップロードURLが取得できませんでした" }), {
        status: 500, headers: corsHeaders,
      });
    }

    console.log("Uploading to Gemini...");
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length": String(fileSize),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: fileBlob,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return new Response(JSON.stringify({ error: `Geminiアップロード失敗: ${err.slice(0, 200)}` }), {
        status: 500, headers: corsHeaders,
      });
    }

    const uploadData = await uploadRes.json();
    const fileUri = uploadData.file?.uri;
    if (!fileUri) {
      return new Response(JSON.stringify({ error: "ファイルURIが取得できませんでした" }), {
        status: 500, headers: corsHeaders,
      });
    }

    // Storageの一時ファイルを削除
    await admin.storage.from("audio-uploads").remove([storagePath]);

    // 文字起こし
    console.log("Transcribing...");
    const transcribeRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
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
      return new Response(JSON.stringify({ error: `文字起こし失敗: ${err.slice(0, 200)}` }), {
        status: 500, headers: corsHeaders,
      });
    }

    const transcribeData = await transcribeRes.json();
    const transcript = transcribeData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    console.log(`Transcript done: ${transcript.length} chars`);

    return new Response(JSON.stringify({ transcript }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("Edge function error:", e);
    return new Response(JSON.stringify({ error: `エラー: ${(e as Error).message}` }), {
      status: 500, headers: corsHeaders,
    });
  }
});
