import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { isQuickCaptureAllowed } from "@/lib/captures";
import { NextResponse } from "next/server";

// 相談セッション一覧(新しい順)
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isQuickCaptureAllowed(user.id)) {
    return NextResponse.json({ error: "この機能は利用できません" }, { status: 403 });
  }

  const sessions = await prisma.consultSession.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, mode: true, tagSlug: true, updatedAt: true, sentToObsidianAt: true },
  });

  // 文脈タグのラベルを付ける(タグが候補から消えた後も履歴では表示できるように)
  const slugs = Array.from(new Set(sessions.map((s) => s.tagSlug).filter((s): s is string => !!s)));
  const defs = slugs.length > 0
    ? await prisma.captureTagDef.findMany({ where: { slug: { in: slugs } }, select: { slug: true, label: true } })
    : [];
  const labelBySlug = new Map(defs.map((d) => [d.slug, d.label]));

  return NextResponse.json(
    sessions.map((s) => ({
      ...s,
      tagLabel: s.tagSlug ? labelBySlug.get(s.tagSlug) ?? s.tagSlug : null,
    }))
  );
}
