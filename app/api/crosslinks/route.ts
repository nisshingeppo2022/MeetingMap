import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const strength = searchParams.get("strength");

  const crossLinks = await prisma.crossLink.findMany({
    where: {
      userId: user.id,
      isVisible: true,
      OR: [{ isAccepted: null }, { isAccepted: true }],
      ...(strength ? { strength: strength as "strong" | "medium" | "weak" } : {}),
    },
    include: {
      fromNode: { select: { id: true, label: true, nodeType: true, meetingId: true } },
      toNode: { select: { id: true, label: true, nodeType: true, meetingId: true } },
    },
    orderBy: [
      { strength: "asc" },
      { createdAt: "desc" },
    ],
  });

  return NextResponse.json(crossLinks);
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { fromNodeId, toNodeId, strength, category, categoryColor, reason, newValueSuggestion } = body;
  if (!fromNodeId || !toNodeId) return NextResponse.json({ error: "fromNodeId と toNodeId は必須です" }, { status: 400 });

  const crossLink = await prisma.crossLink.create({
    data: {
      userId: user.id,
      fromNodeId,
      toNodeId,
      strength: strength ?? "medium",
      category: category ?? null,
      categoryColor: categoryColor ?? "#6366f1",
      reason: reason ?? null,
      newValueSuggestion: newValueSuggestion ?? null,
      isAiGenerated: false,
      isAccepted: true,
      isVisible: true,
    },
  });

  return NextResponse.json(crossLink, { status: 201 });
}
