import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { classifyCapture, isQuickCaptureAllowed } from "@/lib/captures";
import { generateContent, CONSULT_SAVE_PROMPT } from "@/lib/gemini";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

// 「Obsidianへ送る」(14.4)。会話から決定/ToDo/気づきを抽出してcaptureに還流させる。
// 既存の同期パイプライン(P4/P9)がObsidianの_captures.mdまで運ぶ。
// 同じセッションから2回目以降に送る場合は、前回送信以降の新しいやりとりだけを抽出する(重複防止)
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isQuickCaptureAllowed(user.id)) {
    return NextResponse.json({ error: "この機能は利用できません" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const rawTagSlug: string | null = typeof body.tagSlug === "string" && body.tagSlug ? body.tagSlug : null;
  // 文脈なし(none)/最近2週間(recent)の相談はタグ引き継ぎ無し→AI分類に回す
  const tagSlug = body.mode === "tag" || body.mode === undefined ? rawTagSlug : null;
  const sessionId: string | null = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : null;

  const rawMessages: { role: string; content: string }[] = Array.isArray(body.messages) ? body.messages : [];
  const allMessages = rawMessages
    .filter((m) => typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

  if (allMessages.length === 0) return NextResponse.json({ error: "messages は必須です" }, { status: 400 });

  // セッションが特定できれば、前回送信済みの位置から先だけを対象にする
  const session = sessionId
    ? await prisma.consultSession.findFirst({
        where: { id: sessionId, userId: user.id },
        select: { id: true, savedMessageCount: true },
      })
    : null;
  const startIndex = session?.savedMessageCount ?? 0;
  const targetMessages = allMessages.slice(startIndex);

  if (!targetMessages.some((m) => m.role === "user")) {
    return NextResponse.json({
      skipped: true,
      message: "前回Obsidianへ送った後の新しいやりとりがありません",
    });
  }

  const conversation = targetMessages
    .map((m) => `${m.role === "assistant" ? "AI" : "自分"}: ${m.content}`)
    .join("\n\n");

  let content: string;
  try {
    const extracted = await generateContent(
      `${CONSULT_SAVE_PROMPT}\n\n## 会話全文\n${conversation}`,
      { thinkingBudget: 0, retries: 1 }
    );
    content = extracted.trim();
  } catch {
    content = "";
  }
  // 抽出に失敗しても相談内容を失わない(会話をそのまま保存)
  if (!content) content = `(自動抽出失敗のため会話全文)\n\n${conversation}`;
  if (startIndex > 0) content = `(前回送信の続き)\n\n${content}`;

  let tags: string[];
  if (tagSlug) {
    tags = [tagSlug];
  } else {
    const tagDefs = await prisma.captureTagDef.findMany({
      where: { active: true },
      select: { slug: true, label: true, description: true },
      orderBy: { sortOrder: "asc" },
    });
    tags = (await classifyCapture(content, tagDefs)).tags;
  }

  const capture = await prisma.capture.create({
    data: {
      userId: user.id,
      source: "consult",
      content,
      tags,
    },
  });

  if (session) {
    await prisma.consultSession.update({
      where: { id: session.id },
      data: { sentToObsidianAt: new Date(), savedMessageCount: allMessages.length },
    });
  }

  const firstTagDef = tags.length > 0
    ? await prisma.captureTagDef.findUnique({ where: { slug: tags[0] }, select: { label: true } })
    : null;

  return NextResponse.json({
    capture_id: capture.id,
    tags,
    label: firstTagDef?.label ?? tags[0] ?? null,
  });
}
