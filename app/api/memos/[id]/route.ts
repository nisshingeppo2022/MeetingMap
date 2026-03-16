import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { content, tags, isPinned } = body;

  const memo = await prisma.quickMemo.updateMany({
    where: { id: params.id, userId: user.id },
    data: {
      ...(content !== undefined ? { content: content.trim() } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(isPinned !== undefined ? { isPinned } : {}),
    },
  });

  if (memo.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.quickMemo.deleteMany({ where: { id: params.id, userId: user.id } });
  return NextResponse.json({ success: true });
}
