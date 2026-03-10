import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

// 日本語・英語ストップワード（助詞・助動詞・接続詞・一般動詞など）
const STOP_WORDS = new Set([
  // 1文字助詞
  "の","に","は","を","が","で","と","や","へ","も","か","な","ず","て","し",
  // 2文字以上の助詞・接続助詞
  "から","まで","より","ので","のに","けど","けれ","ども","でも","だが","また",
  "との","での","への","には","では","とは","から","まで","ても","でも","など",
  "ため","ほど","だけ","しか","ばかり","について","にて","として","にとって",
  // 指示語・代名詞
  "これ","それ","あれ","この","その","あの","こと","もの","ところ","とき","ここ",
  // 動詞・助動詞の語幹
  "する","した","して","します","ない","ある","いる","なる","れる","られ","せる",
  "させ","でき","おり","あり","なり","いい","よい","わる","ため","かも","べき",
  "という","として","ている","てい","であ","であり","です","ます","でし","まし",
  "ので","のに","だけ","たり","たら","なら","れば","ければ","でき","でき",
  // 一般的すぎる名詞（具体性のない語）
  "こと","もの","ひと","人","場合","方法","状況","内容","関連","活用","利用","使用",
  // 英語ストップワード
  "a","an","the","is","are","was","be","of","in","to","for","and","or","with",
  "by","at","on","it","its","we","our","this","that","as","from","about",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\u3000、。・,.!?！？「」【】『』（）()\-_/\\：:・〜～]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

const CATEGORY_COLORS = [
  "#6366f1","#16a34a","#ea580c","#0891b2","#9333ea","#be185d","#ca8a04",
];

export async function POST() {
  try {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // completed ミーティングを取得
  const meetings = await prisma.meeting.findMany({
    where: { userId: user.id, status: "completed" },
    orderBy: { date: "desc" },
    take: 20,
    include: { mindmapNodes: { orderBy: { sortOrder: "asc" } } },
  });

  console.log(`[crosslinks] meetings found: ${meetings.length}`);

  if (meetings.length < 2) {
    return NextResponse.json({ error: "クロスリンク検出には2件以上の分析済みミーティングが必要です" }, { status: 400 });
  }

  // 星付きノード＋その子孫を収集
  const nodeRegistry: { id: string; meetingId: string; label: string; nodeType: string }[] = [];

  for (const m of meetings) {
    // 親子マップを構築
    const childMap = new Map<string, string[]>();
    const nodeMap = new Map<string, typeof m.mindmapNodes[0]>();
    for (const n of m.mindmapNodes) {
      nodeMap.set(n.id, n);
      if (n.parentId) {
        if (!childMap.has(n.parentId)) childMap.set(n.parentId, []);
        childMap.get(n.parentId)!.push(n.id);
      }
    }

    // 星付きノードの子孫を再帰的に収集（重複除去用Set）
    const candidateIds = new Set<string>();
    const collectDescendants = (id: string) => {
      if (candidateIds.has(id)) return;
      candidateIds.add(id);
      for (const cid of childMap.get(id) ?? []) collectDescendants(cid);
    };

    for (const n of m.mindmapNodes) {
      if (n.isStarred) collectDescendants(n.id);
    }

    for (const id of Array.from(candidateIds)) {
      const n = nodeMap.get(id);
      if (n) nodeRegistry.push({ id: n.id, meetingId: m.id, label: n.label, nodeType: n.nodeType });
    }
  }

  console.log(`[crosslinks] candidate nodes (starred + descendants): ${nodeRegistry.length}`);

  // 異なるミーティングに星が2件以上あるか確認
  const meetingIds = new Set(nodeRegistry.map((n) => n.meetingId));
  if (meetingIds.size < 2) {
    return NextResponse.json({
      error: "複数のミーティングのノードに⭐を付けてください。各ミーティングのマップでノードをタップ→「候補にする」で星が付きます。",
    }, { status: 400 });
  }

  // キーワードマッチングでクロスリンクを検出
  type Result = {
    from: string; to: string; strength: "strong" | "medium" | "weak";
    category: string; color: string; reason: string; suggestion: string;
  };
  const results: Result[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < nodeRegistry.length; i++) {
    for (let j = i + 1; j < nodeRegistry.length; j++) {
      const a = nodeRegistry[i];
      const b = nodeRegistry[j];
      if (a.meetingId === b.meetingId) continue;

      const key = [a.id, b.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);

      const tokA = tokenize(a.label);
      const tokB = tokenize(b.label);
      const tokBSet = new Set(tokB);
      const labelA = a.label.toLowerCase();
      const labelB = b.label.toLowerCase();

      // 完全一致 + 部分文字列マッチ（4文字以上の語のみ、助詞混じり短縮語を除外）
      const commonSet = new Set<string>();
      for (const w of tokA) {
        if (tokBSet.has(w)) commonSet.add(w);
        else if (w.length >= 4 && labelB.includes(w)) commonSet.add(w);
      }
      for (const w of tokB) {
        if (!commonSet.has(w) && w.length >= 4 && labelA.includes(w)) commonSet.add(w);
      }
      const common = Array.from(commonSet);

      const colorIdx = results.length % CATEGORY_COLORS.length;

      if (common.length >= 1) {
        const strength: "strong" | "medium" | "weak" =
          common.length >= 3 ? "strong" : common.length >= 2 ? "medium" : "weak";
        results.push({
          from: a.id, to: b.id, strength,
          category: `共通: ${common.slice(0, 2).join("・")}`,
          color: CATEGORY_COLORS[colorIdx],
          reason: `「${common.join("、")}」というキーワードが両方に含まれています。`,
          suggestion: `${a.label} と ${b.label} を連携させることを検討してみてください。`,
        });
      }

      if (results.length >= 15) break;
    }
    if (results.length >= 15) break;
  }

  console.log(`[crosslinks] crosslinks to create: ${results.length}`);

  // 既存のAI生成クロスリンクを削除
  await prisma.crossLink.deleteMany({ where: { userId: user.id, isAiGenerated: true } });

  if (results.length === 0) {
    return NextResponse.json({ success: true, count: 0, method: "keyword" });
  }

  const created = await prisma.crossLink.createMany({
    data: results.map((r) => ({
      userId: user.id,
      fromNodeId: r.from,
      toNodeId: r.to,
      strength: r.strength,
      category: r.category,
      categoryColor: r.color,
      reason: r.reason,
      newValueSuggestion: r.suggestion,
      isAiGenerated: true,
      isAccepted: null,
      isVisible: true,
    })),
    skipDuplicates: true,
  });

  console.log(`[crosslinks] created: ${created.count}`);

  return NextResponse.json({ success: true, count: created.count, method: "keyword" });
  } catch (e) {
    console.error("[crosslinks] ERROR:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
