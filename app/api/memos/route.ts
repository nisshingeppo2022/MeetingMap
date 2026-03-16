import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memos = await prisma.quickMemo.findMany({
    where: { userId: user.id },
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json(memos);
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { content, tags, isPinned } = body;
  if (!content?.trim()) return NextResponse.json({ error: "content は必須です" }, { status: 400 });

  const memo = await prisma.quickMemo.create({
    data: {
      userId: user.id,
      content: content.trim(),
      tags: tags ?? [],
      isPinned: isPinned ?? false,
    },
  });

  return NextResponse.json(memo, { status: 201 });
}
