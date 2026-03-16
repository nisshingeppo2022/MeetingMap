import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const topicNodes = await prisma.mindmapNode.findMany({
    where: {
      meeting: { userId: user.id },
      nodeType: "topic",
    },
    include: {
      meeting: {
        select: {
          title: true,
          date: true,
          contact: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(topicNodes);
}
