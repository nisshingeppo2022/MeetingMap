import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { classifyCapture } from "@/lib/captures";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 15;

// 会議のマインドマップ出力をクイックキャプチャのcapturesに送る
// (Webセッション認証。デバイストークンではなく、ログイン中のユーザー自身の操作)
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!meeting) return NextResponse.json({ error: "ミーティングが見つかりません" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const content: string = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return NextResponse.json({ error: "content は必須です" }, { status: 400 });

  const capture = await prisma.capture.create({
    data: {
      userId: user.id,
      source: "meetingmap",
      content,
      meetingId: meeting.id,
      tags: [],
    },
  });

  const tagDefs = await prisma.captureTagDef.findMany({
    where: { active: true },
    select: { slug: true, label: true, description: true },
    orderBy: { sortOrder: "asc" },
  });
  const result = await classifyCapture(content, tagDefs);
  await prisma.capture.update({ where: { id: capture.id }, data: { tags: result.tags } });

  const firstTagDef = result.tags.length > 0
    ? await prisma.captureTagDef.findUnique({ where: { slug: result.tags[0] }, select: { label: true } })
    : null;

  return NextResponse.json({
    capture_id: capture.id,
    tags: result.tags,
    label: firstTagDef?.label ?? result.tags[0] ?? null,
  });
}
