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

  const PROJECT_ACTIVE_DAYS = 90; // この期間キャプチャが無いプロジェクトは候補から自然に消える
  const RECENT_TAG_DAYS = 30;
  const RECENT_TAG_MIN_COUNT = 2;

  const [tagDefs, recentCaptures, context] = await Promise.all([
    prisma.captureTagDef.findMany({
      where: { active: true },
      select: { slug: true, label: true, isProject: true, createdAt: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.capture.findMany({
      where: {
        userId: user.id,
        createdAt: { gte: new Date(Date.now() - PROJECT_ACTIVE_DAYS * 24 * 60 * 60 * 1000) },
      },
      select: { tags: true, createdAt: true },
    }),
    buildConsultContext(user.id, tagSlug),
  ]);

  // タグごとの直近利用状況を集計
  const recentThreshold = Date.now() - RECENT_TAG_DAYS * 24 * 60 * 60 * 1000;
  const usedIn90d = new Set<string>();
  const countIn30d = new Map<string, number>();
  for (const c of recentCaptures) {
    for (const t of c.tags) {
      usedIn90d.add(t);
      if (c.createdAt.getTime() >= recentThreshold) {
        countIn30d.set(t, (countIn30d.get(t) ?? 0) + 1);
      }
    }
  }

  // プロジェクトタグ: 直近90日に利用があるもの + 登録から30日以内の新規(まだ0件でも表示)
  const projects = tagDefs
    .filter((t) => t.isProject)
    .filter((t) => usedIn90d.has(t.slug) || t.createdAt.getTime() >= recentThreshold)
    .map((t) => ({ slug: t.slug, label: t.label }));

  // 最近よく出てくるトピック: 直近30日に2件以上あるタグ(プロジェクト/inbox/clipを除く)を件数順で最大5個
  const projectSlugs = new Set(projects.map((p) => p.slug));
  const labelBySlug = new Map(tagDefs.map((t) => [t.slug, t.label]));
  const recentTags = Array.from(countIn30d.entries())
    .filter(([slug, count]) =>
      count >= RECENT_TAG_MIN_COUNT &&
      !projectSlugs.has(slug) &&
      slug !== "inbox" &&
      slug !== "clip" &&
      labelBySlug.has(slug)
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([slug]) => ({ slug, label: labelBySlug.get(slug)! }));

  return NextResponse.json({
    projects,
    recentTags,
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
