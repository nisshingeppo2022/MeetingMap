import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { generateContent, TAG_ONLY_PROMPT } from "@/lib/gemini";
import { saveMeetingTags } from "@/lib/tags";
import { NextRequest, NextResponse } from "next/server";

// タグ未付与の会議一覧を返す
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meetings = await prisma.meeting.findMany({
    where: {
      userId: user.id,
      transcript: { not: null },
      meetingTopics: { none: {} },
    },
    select: { id: true, title: true, date: true },
    orderBy: { date: "desc" },
  });

  return NextResponse.json({ meetings, count: meetings.length });
}

// 1会議のタグを生成・保存する(1リクエスト=1会議、ループ処理は行わない)
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { meeting_id } = await request.json();
  if (!meeting_id) {
    return NextResponse.json({ error: "meeting_id は必須です" }, { status: 400 });
  }

  const meeting = await prisma.meeting.findFirst({
    where: { id: meeting_id, userId: user.id },
    include: { _count: { select: { meetingTopics: true } } },
  });
  if (!meeting) {
    return NextResponse.json({ error: "ミーティングが見つかりません" }, { status: 404 });
  }
  if (meeting._count.meetingTopics > 0) {
    return NextResponse.json({ skipped: true });
  }
  if (!meeting.transcript) {
    return NextResponse.json({ error: "文字起こしがありません" }, { status: 400 });
  }

  const existingTags = await prisma.topic.findMany({
    where: { userId: user.id, status: "active" },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  const tagsListSection = existingTags.length
    ? `\n\n## 既存タグ一覧\n${existingTags.map((t) => t.name).join("、")}`
    : "";

  const prompt = `${TAG_ONLY_PROMPT}${tagsListSection}

## 文字起こし
${meeting.transcript}`;

  let tagNames: string[] = [];
  try {
    const raw = await generateContent(prompt);
    const stripped = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`JSONが見つかりません。レスポンス: ${raw.slice(0, 300)}`);
    const parsed = JSON.parse(jsonMatch[0]);
    tagNames = Array.isArray(parsed.tags) ? parsed.tags : [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `タグ生成に失敗しました: ${msg.slice(0, 200)}` }, { status: 500 });
  }

  const tags = await saveMeetingTags(user.id, meeting_id, tagNames);

  return NextResponse.json({ success: true, tags });
}
