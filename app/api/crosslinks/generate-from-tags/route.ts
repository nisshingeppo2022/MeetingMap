import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const maxDuration = 30;

function strengthFromCount(count: number): "strong" | "medium" | "weak" {
  if (count >= 3) return "strong";
  if (count === 2) return "medium";
  return "weak";
}

// meeting_topics から「同じタグを持つ会議のペア」を列挙し、cross_links に保存する。
// Gemini は呼ばずDB内の計算のみで完結させる(タイムアウトなし)。
export async function POST() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rootNodes = await prisma.mindmapNode.findMany({
    where: { nodeType: "root", meeting: { userId: user.id } },
    select: { id: true, meetingId: true },
  });
  const rootNodeIdByMeetingId = new Map(rootNodes.map((n) => [n.meetingId, n.id]));

  const meetingTopics = await prisma.meetingTopic.findMany({
    where: { topic: { userId: user.id } },
    select: { meetingId: true, topic: { select: { name: true } } },
  });
  const meetingIdsByTagName = new Map<string, string[]>();
  meetingTopics.forEach((mt) => {
    const list = meetingIdsByTagName.get(mt.topic.name) ?? [];
    list.push(mt.meetingId);
    meetingIdsByTagName.set(mt.topic.name, list);
  });

  // ペアごとに共通タグ名を蓄積(meetingId昇順で正規化し、A→B/B→Aの重複を防ぐ)
  const sharedTagsByPair = new Map<string, Set<string>>();
  Array.from(meetingIdsByTagName.entries()).forEach(([tagName, meetingIds]) => {
    const uniqueIds = Array.from(new Set(meetingIds)).sort();
    for (let i = 0; i < uniqueIds.length; i++) {
      for (let j = i + 1; j < uniqueIds.length; j++) {
        const pairKey = `${uniqueIds[i]}|${uniqueIds[j]}`;
        if (!sharedTagsByPair.has(pairKey)) sharedTagsByPair.set(pairKey, new Set());
        sharedTagsByPair.get(pairKey)!.add(tagName);
      }
    }
  });

  // 既にタグベースで生成済みのペア(sharedTagsが空でないもの)はスキップ
  const existing = await prisma.crossLink.findMany({
    where: { userId: user.id, sharedTags: { isEmpty: false } },
    select: { fromNodeId: true, toNodeId: true },
  });
  const existingPairKeys = new Set(existing.map((e) => `${e.fromNodeId}|${e.toNodeId}`));

  const toCreate: {
    userId: string;
    fromNodeId: string;
    toNodeId: string;
    sharedTags: string[];
    strength: "strong" | "medium" | "weak";
    isAiGenerated: boolean;
    isAccepted: boolean;
    isVisible: boolean;
  }[] = [];
  let skipped = 0;

  Array.from(sharedTagsByPair.entries()).forEach(([pairKey, tagSet]) => {
    const [meetingIdA, meetingIdB] = pairKey.split("|");
    const fromNodeId = rootNodeIdByMeetingId.get(meetingIdA);
    const toNodeId = rootNodeIdByMeetingId.get(meetingIdB);
    if (!fromNodeId || !toNodeId) return; // ルートノード未生成の会議はスキップ

    const nodePairKey = `${fromNodeId}|${toNodeId}`;
    if (existingPairKeys.has(nodePairKey)) {
      skipped++;
      return;
    }

    const sharedTags: string[] = Array.from(tagSet);
    toCreate.push({
      userId: user.id,
      fromNodeId,
      toNodeId,
      sharedTags,
      strength: strengthFromCount(sharedTags.length),
      isAiGenerated: false,
      isAccepted: true,
      isVisible: true,
    });
  });

  if (toCreate.length > 0) {
    await prisma.crossLink.createMany({ data: toCreate });
  }

  return NextResponse.json({ created: toCreate.length, skipped });
}
