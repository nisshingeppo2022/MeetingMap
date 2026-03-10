import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { label, status, isVisible, isSecret, isStarred, positionX, positionY } = body;

  await prisma.mindmapNode.updateMany({
    where: {
      id: params.id,
      meeting: { userId: user.id },
    },
    data: {
      ...(label !== undefined && { label }),
      ...(status !== undefined && { status }),
      ...(isVisible !== undefined && { isVisible }),
      ...(isSecret !== undefined && { isSecret }),
      ...(isStarred !== undefined && { isStarred }),
      ...(positionX !== undefined && { positionX }),
      ...(positionY !== undefined && { positionY }),
    },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.mindmapNode.deleteMany({
    where: { id: params.id, meeting: { userId: user.id } },
  });

  return NextResponse.json({ success: true });
}
