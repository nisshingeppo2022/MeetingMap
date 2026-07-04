import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { classifyCapture, isQuickCaptureAllowed } from "@/lib/captures";
import { generateContent, CONSULT_SAVE_PROMPT } from "@/lib/gemini";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

// 「この相談を保存」(14.4)。会話全文から決定/ToDo/気づきを抽出してcaptureに還流させる。
// 既存の同期パイプライン(P4/P9)がObsidianの_captures.mdまで運ぶ
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
  const conversation = rawMessages
    .filter((m) => typeof m.content === "string" && m.content.trim())
    .map((m) => `${m.role === "assistant" ? "AI" : "自分"}: ${m.content}`)
    .join("\n\n");

  if (!conversation) return NextResponse.json({ error: "messages は必須です" }, { status: 400 });

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
  // 抽出に失敗しても相談内容を失わない(会話全文をそのまま保存)
  if (!content) content = `(自動抽出失敗のため会話全文)\n\n${conversation}`;

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

  const firstTagDef = tags.length > 0
    ? await prisma.captureTagDef.findUnique({ where: { slug: tags[0] }, select: { label: true } })
    : null;

  return NextResponse.json({
    capture_id: capture.id,
    tags,
    label: firstTagDef?.label ?? tags[0] ?? null,
  });
}
