import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

// スイムレーンマップ用の軽量な概要データ。ノード本体は含めない(nodeCountのみ)。
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meetings = await prisma.meeting.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      title: true,
      date: true,
      createdAt: true,
      _count: { select: { mindmapNodes: true } },
      meetingTopics: {
        select: { topic: { select: { id: true, name: true, status: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const meetingsOut = meetings.map((m) => ({
    id: m.id,
    title: m.title,
    date: m.date,
    createdAt: m.createdAt,
    nodeCount: m._count.mindmapNodes,
    tags: m.meetingTopics.map((mt) => mt.topic),
  }));

  const crossLinks = await prisma.crossLink.findMany({
    where: {
      userId: user.id,
      isVisible: true,
      OR: [{ isAccepted: null }, { isAccepted: true }],
    },
    select: {
      id: true,
      strength: true,
      sharedTags: true,
      fromNode: { select: { meetingId: true } },
      toNode: { select: { meetingId: true } },
    },
  });

  const crossLinksOut = crossLinks.map((c) => ({
    id: c.id,
    fromMeetingId: c.fromNode.meetingId,
    toMeetingId: c.toNode.meetingId,
    strength: c.strength,
    sharedTags: c.sharedTags,
  }));

  return NextResponse.json({ meetings: meetingsOut, crossLinks: crossLinksOut });
}
