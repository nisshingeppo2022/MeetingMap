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

// 会話内容を更新(ストリーミング完了後にクライアントから全文を保存する。
// サーバー側のストリーム完了フックはVercelで実行保証がないため、保存はクライアント主導)
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isQuickCaptureAllowed(user.id)) {
    return NextResponse.json({ error: "この機能は利用できません" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const messages = Array.isArray(body.messages)
    ? body.messages
        .filter((m: { role?: string; content?: string }) =>
          (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
        .map((m: { role: string; content: string }) => ({ role: m.role, content: m.content }))
    : null;
  if (!messages || messages.length === 0) {
    return NextResponse.json({ error: "messages は必須です" }, { status: 400 });
  }

  const session = await prisma.consultSession.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!session) return NextResponse.json({ error: "見つかりません" }, { status: 404 });

  await prisma.consultSession.update({
    where: { id: session.id },
    data: { messages, updatedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
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

  // この相談からObsidianへ送ったcaptureにも削除マークを付ける
  // (次回のObsidian同期でVault内のファイルも削除され、その後DBからも消える)
  await prisma.capture.updateMany({
    where: { consultSessionId: session.id, userId: user.id, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  await prisma.consultSession.delete({ where: { id: session.id } });
  return NextResponse.json({ ok: true });
}
