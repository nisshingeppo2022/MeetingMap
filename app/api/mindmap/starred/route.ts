import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // completedミーティングのノードを取得
  const meetings = await prisma.meeting.findMany({
    where: { userId: user.id, status: "completed" },
    orderBy: { date: "desc" },
    take: 30,
    select: {
      id: true,
      title: true,
      date: true,
      mindmapNodes: {
        select: { id: true, parentId: true, label: true, nodeType: true, isStarred: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  // 星付きノード＋その子孫を収集
  const result: { id: string; label: string; nodeType: string; meetingId: string; meetingTitle: string | null; meetingDate: Date }[] = [];

  for (const m of meetings) {
    const childMap = new Map<string, string[]>();
    const nodeMap = new Map<string, typeof m.mindmapNodes[0]>();
    for (const n of m.mindmapNodes) {
      nodeMap.set(n.id, n);
      if (n.parentId) {
        if (!childMap.has(n.parentId)) childMap.set(n.parentId, []);
        childMap.get(n.parentId)!.push(n.id);
      }
    }

    const candidateIds = new Set<string>();
    const collect = (id: string) => {
      if (candidateIds.has(id)) return;
      candidateIds.add(id);
      for (const cid of childMap.get(id) ?? []) collect(cid);
    };
    for (const n of m.mindmapNodes) {
      if (n.isStarred) collect(n.id);
    }

    for (const id of Array.from(candidateIds)) {
      const n = nodeMap.get(id);
      if (n) result.push({ id: n.id, label: n.label, nodeType: n.nodeType, meetingId: m.id, meetingTitle: m.title, meetingDate: m.date });
    }
  }

  return NextResponse.json(result);
}
