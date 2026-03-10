import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { generateContent, ANALYZE_PROMPT } from "@/lib/gemini";
import { NextRequest, NextResponse } from "next/server";
import type { AiAnalysisResult, AiNode } from "@/types";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { meeting_id, transcript, contact_name, contact_org } = await request.json();
  if (!meeting_id || !transcript) {
    return NextResponse.json({ error: "meeting_id と transcript は必須です" }, { status: 400 });
  }

  // Gemini に送信
  const prompt = `${ANALYZE_PROMPT}

## ミーティング情報
- 相手: ${contact_name ?? "不明"} (${contact_org ?? "不明"})
- 文字起こし:
${transcript}`;

  let analysisResult: AiAnalysisResult;
  try {
    const raw = await generateContent(prompt);
    console.log("Gemini raw response (first 500):", raw.slice(0, 500));

    // コードブロックを除去してJSONを抽出
    const stripped = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`JSONが見つかりません。レスポンス: ${raw.slice(0, 300)}`);
    analysisResult = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("Gemini error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `AI分析に失敗しました: ${msg.slice(0, 200)}` }, { status: 500 });
  }

  // ミーティングのタイトルとai_analysisを保存
  await prisma.meeting.updateMany({
    where: { id: meeting_id, userId: user.id },
    data: {
      title: analysisResult.root?.label ?? "ミーティング",
      aiAnalysis: analysisResult as object,
      status: "completed",
    },
  });

  // 既存ノードを削除して再生成
  await prisma.mindmapNode.deleteMany({ where: { meetingId: meeting_id } });

  // ルートノード作成
  const rootNode = await prisma.mindmapNode.create({
    data: {
      meetingId: meeting_id,
      label: analysisResult.root?.label ?? "ミーティング",
      nodeType: "root",
      positionX: 0,
      positionY: 0,
      sortOrder: 0,
    },
  });

  // 子ノードを再帰的に作成
  async function createNodes(nodes: AiNode[], parentId: string, depth: number) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const created = await prisma.mindmapNode.create({
        data: {
          meetingId: meeting_id,
          parentId,
          label: n.label,
          nodeType: n.type ?? "item",
          status: n.status ?? null,
          isSecret: n.is_secret ?? false,
          positionX: depth * 250,
          positionY: i * 100,
          sortOrder: i,
        },
      });
      if (n.children?.length) {
        await createNodes(n.children, created.id, depth + 1);
      }
    }
  }

  if (analysisResult.nodes?.length) {
    await createNodes(analysisResult.nodes, rootNode.id, 1);
  }

  // アクションアイテムノード追加
  if (analysisResult.action_items?.length) {
    const actionRoot = await prisma.mindmapNode.create({
      data: {
        meetingId: meeting_id,
        parentId: rootNode.id,
        label: "アクションアイテム",
        nodeType: "topic",
        positionX: 250,
        positionY: analysisResult.nodes.length * 100,
        sortOrder: analysisResult.nodes.length,
      },
    });
    for (let i = 0; i < analysisResult.action_items.length; i++) {
      const a = analysisResult.action_items[i];
      await prisma.mindmapNode.create({
        data: {
          meetingId: meeting_id,
          parentId: actionRoot.id,
          label: `${a.task}${a.assignee ? ` (${a.assignee})` : ""}`,
          nodeType: "action",
          positionX: 500,
          positionY: i * 80,
          sortOrder: i,
        },
      });
    }
  }

  const nodes = await prisma.mindmapNode.findMany({
    where: { meetingId: meeting_id },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ success: true, nodes, analysis: analysisResult });
}
