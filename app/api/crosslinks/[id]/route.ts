import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { isAccepted, reason, newValueSuggestion, category, categoryColor, strength } = body;

  const result = await prisma.crossLink.updateMany({
    where: { id: params.id, userId: user.id },
    data: {
      ...(isAccepted !== undefined && { isAccepted }),
      ...(reason !== undefined && { reason }),
      ...(newValueSuggestion !== undefined && { newValueSuggestion }),
      ...(category !== undefined && { category }),
      ...(categoryColor !== undefined && { categoryColor }),
      ...(strength !== undefined && { strength }),
    },
  });

  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.crossLink.deleteMany({ where: { id: params.id, userId: user.id } });
  return NextResponse.json({ success: true });
}
