import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { generateContent, CROSSLINK_ANALYSIS_PROMPT } from "@/lib/gemini";
import { NextResponse } from "next/server";

const CATEGORY_COLORS: Record<string, string> = {
  synthesis:    "#6366f1",
  common_issue: "#16a34a",
  conflict:     "#ef4444",
};

const TYPE_LABELS: Record<string, string> = {
  synthesis:    "合成",
  common_issue: "共通課題",
  conflict:     "コンフリクト",
};

export async function POST() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // 完了済みミーティングを最新20件取得（topic/rootノードのみ）
    const meetings = await prisma.meeting.findMany({
      where: { userId: user.id, status: "completed" },
      orderBy: { date: "desc" },
      take: 20,
      include: {
        mindmapNodes: {
          where: { nodeType: { in: ["root", "topic"] }, isVisible: true },
          orderBy: { sortOrder: "asc" },
        },
        meetingContacts: { include: { contact: { select: { name: true } } } },
      },
    });

    if (meetings.length < 2) {
      return NextResponse.json(
        { error: "クロスリンク検出には2件以上の分析済みミーティングが必要です" },
        { status: 400 }
      );
    }

    // ミーティングサマリーを構築（ルートノード + トピックノードのラベル）
    const summaries = meetings.map((m, i) => {
      const rootNode = m.mindmapNodes.find((n) => n.nodeType === "root");
      const topicNodes = m.mindmapNodes.filter((n) => n.nodeType === "topic");
      const contactNames = m.meetingContacts.map((mc) => mc.contact.name).join("、");
      const title = m.title ?? rootNode?.label ?? "タイトルなし";
      const topics = topicNodes.map((n) => n.label).join("、");
      const date = new Date(m.date).toLocaleDateString("ja-JP");
      return `[${i}] ${title}（${date}${contactNames ? " / " + contactNames : ""}）: ${topics || "トピックなし"}`;
    });

    const prompt = `${CROSSLINK_ANALYSIS_PROMPT}\n\n## ミーティング一覧\n${summaries.join("\n")}`;

    console.log(`[crosslinks] Gemini分析開始: ${meetings.length}件のミーティング`);

    const raw = await generateContent(prompt, { thinkingBudget: 0 });

    // JSONパース（コードブロックがあれば除去）
    const jsonText = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let parsed: {
      crosslinks: {
        fromMeetingIndex: number;
        toMeetingIndex: number;
        type: string;
        strength: string;
        reason: string;
        suggestion: string;
        category: string;
      }[];
    };

    try {
      parsed = JSON.parse(jsonText);
    } catch {
      console.error("[crosslinks] JSONパースエラー:", jsonText.slice(0, 500));
      return NextResponse.json({ error: "AI分析結果のパースに失敗しました" }, { status: 500 });
    }

    const crosslinks = parsed.crosslinks ?? [];
    console.log(`[crosslinks] Gemini検出数: ${crosslinks.length}`);

    // 各ミーティングのルートノードIDをマッピング
    const rootNodeIds = meetings.map((m) => {
      const root = m.mindmapNodes.find((n) => n.nodeType === "root");
      return root?.id ?? null;
    });

    // 既存のAI生成クロスリンクを削除
    await prisma.crossLink.deleteMany({ where: { userId: user.id, isAiGenerated: true } });

    if (crosslinks.length === 0) {
      return NextResponse.json({ success: true, count: 0 });
    }

    // 有効なペアのみフィルタ
    const validCrosslinks = crosslinks.filter((cl) => {
      const fromId = rootNodeIds[cl.fromMeetingIndex];
      const toId = rootNodeIds[cl.toMeetingIndex];
      return fromId && toId && cl.fromMeetingIndex !== cl.toMeetingIndex;
    });

    const typeLabel = (type: string) => TYPE_LABELS[type] ?? type;
    const typeColor = (type: string) => CATEGORY_COLORS[type] ?? "#6366f1";
    const normalizeStrength = (s: string): "strong" | "medium" | "weak" =>
      s === "strong" || s === "medium" || s === "weak" ? s : "medium";

    const created = await prisma.crossLink.createMany({
      data: validCrosslinks.map((cl) => ({
        userId: user.id,
        fromNodeId: rootNodeIds[cl.fromMeetingIndex]!,
        toNodeId: rootNodeIds[cl.toMeetingIndex]!,
        strength: normalizeStrength(cl.strength),
        category: `[${typeLabel(cl.type)}] ${cl.category}`,
        categoryColor: typeColor(cl.type),
        reason: cl.reason,
        newValueSuggestion: cl.suggestion,
        isAiGenerated: true,
        isAccepted: null,
        isVisible: true,
      })),
      skipDuplicates: true,
    });

    console.log(`[crosslinks] 作成完了: ${created.count}件`);
    return NextResponse.json({ success: true, count: created.count });

  } catch (e) {
    console.error("[crosslinks] ERROR:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
