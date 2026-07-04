import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { buildConsultContext, isQuickCaptureAllowed } from "@/lib/captures";
import { generateContentStream, CONSULT_SYSTEM_PROMPT, ChatMessage } from "@/lib/gemini";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

// GET: 相談モードの文脈選択肢(プロジェクトタグ一覧)と、選択中の文脈の内訳を返す
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isQuickCaptureAllowed(user.id)) {
    return NextResponse.json({ error: "この機能は利用できません" }, { status: 403 });
  }

  const tagSlug = request.nextUrl.searchParams.get("tag") || null;

  const [projects, context] = await Promise.all([
    prisma.captureTagDef.findMany({
      where: { active: true, isProject: true },
      select: { slug: true, label: true },
      orderBy: { sortOrder: "asc" },
    }),
    buildConsultContext(user.id, tagSlug),
  ]);

  return NextResponse.json({
    projects,
    breakdown: {
      meetings: context.meetingCount,
      memos: context.memoCount,
      clips: context.clipCount,
    },
  });
}

// POST: 壁打ち相談。capturesから文脈を組み立ててGeminiにストリーミングさせる
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isQuickCaptureAllowed(user.id)) {
    return NextResponse.json({ error: "この機能は利用できません" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const tagSlug: string | null = typeof body.tagSlug === "string" && body.tagSlug ? body.tagSlug : null;
  const rawMessages: { role: string; content: string }[] = Array.isArray(body.messages) ? body.messages : [];
  const messages: ChatMessage[] = rawMessages
    .filter((m) => typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", text: m.content }));

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "messages は必須です" }, { status: 400 });
  }

  const context = await buildConsultContext(user.id, tagSlug);
  const systemPrompt = `${CONSULT_SYSTEM_PROMPT}

## プロジェクトの文脈(議事録${context.meetingCount}件・メモ${context.memoCount}件・クリップ${context.clipCount}件)
${context.contextText || "(まだ文脈になるキャプチャがありません。その旨を伝えた上で、一般的な壁打ち相手として応じてください)"}`;

  try {
    const stream = await generateContentStream(messages, systemPrompt);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "AIの呼び出しに失敗しました";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
