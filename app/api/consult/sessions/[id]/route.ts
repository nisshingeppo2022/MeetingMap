import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { isQuickCaptureAllowed } from "@/lib/captures";
import { NextRequest, NextResponse } from "next/server";

// 相談セッション1件(メッセージ全文込み)を取得
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isQuickCaptureAllowed(user.id)) {
    return NextResponse.json({ error: "この機能は利用できません" }, { status: 403 });
  }

  const session = await prisma.consultSession.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!session) return NextResponse.json({ error: "見つかりません" }, { status: 404 });

  return NextResponse.json(session);
}

// 相談セッションを削除
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isQuickCaptureAllowed(user.id)) {
    return NextResponse.json({ error: "この機能は利用できません" }, { status: 403 });
  }

  const session = await prisma.consultSession.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!session) return NextResponse.json({ error: "見つかりません" }, { status: 404 });

  await prisma.consultSession.delete({ where: { id: session.id } });
  return NextResponse.json({ ok: true });
}
