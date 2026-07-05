import { prisma } from "@/lib/prisma";
import { generateContent, WEEKLY_DREAMING_PROMPT } from "@/lib/gemini";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

// 週次Dreaming(15.2)。毎週日曜 12:00 UTC (JST 21:00) に Vercel Cron が呼ぶ。
// 直近7日の記録からパターン・未決の問いを抽出し、capturesに還流させる
// (既存の同期でObsidianへ流れ、学期末の振り返りモードの素材になる)。
// Discord Webhook (DISCORD_WEBHOOK_BRIEF) が設定されていれば通知も送る。
export async function GET(request: NextRequest) {
  // Vercel Cron は CRON_SECRET 設定時に Authorization: Bearer <secret> を付けて呼ぶ
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET が未設定です" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 対象ユーザーの決定(13章: cronは必ず自分のuser_idで絞る)。
  // 環境変数が無い場合、capturesの持ち主が1人だけならそのユーザーとみなす(単一ユーザー運用)
  let userId = process.env.CAPTURE_OWNER_USER_ID ?? null;
  if (!userId) {
    const owners = await prisma.capture.groupBy({ by: ["userId"] });
    if (owners.length === 1) userId = owners[0].userId;
  }
  if (!userId) {
    return NextResponse.json(
      { error: "対象ユーザーを特定できません。CAPTURE_OWNER_USER_ID を設定してください" },
      { status: 500 }
    );
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [recentCaptures, previousDreamings, soulConfig] = await Promise.all([
    prisma.capture.findMany({
      where: { userId, deletedAt: null, createdAt: { gte: weekAgo }, source: { not: "system" } },
      orderBy: { createdAt: "asc" },
      select: { source: true, content: true, tags: true, createdAt: true },
    }),
    prisma.capture.findMany({
      where: { userId, source: "system", tags: { has: "retrospective" } },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { content: true, createdAt: true },
    }),
    prisma.appConfig.findUnique({ where: { key: "soul" } }),
  ]);

  if (recentCaptures.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "直近7日の記録がありません" });
  }

  const fmt = (d: Date) =>
    d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
  const weekSection = recentCaptures
    .map((c) => `[${fmt(c.createdAt)} ${c.source}${c.tags.length ? ` #${c.tags.join(",")}` : ""}]\n${c.content.slice(0, 1500)}`)
    .join("\n\n---\n\n");
  const previousSection = previousDreamings.length > 0
    ? previousDreamings.map((d) => `(${fmt(d.createdAt)})\n${d.content}`).join("\n\n---\n\n")
    : "(なし・初回)";

  const prompt = `${WEEKLY_DREAMING_PROMPT}
${soulConfig ? `\n## 本人について(_soul.md)\n${soulConfig.value}\n` : ""}
## 過去の週次ふりかえり
${previousSection}

## 今週の記録
${weekSection}`;

  let content: string;
  try {
    content = (await generateContent(prompt, { retries: 1, fallbackModel: "gemini-2.5-flash-lite" })).trim();
  } catch (e) {
    return NextResponse.json(
      { error: `生成に失敗しました: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 502 }
    );
  }
  if (!content) {
    return NextResponse.json({ error: "生成結果が空でした" }, { status: 502 });
  }

  const capture = await prisma.capture.create({
    data: { userId, source: "system", content, tags: ["retrospective"] },
  });

  // Discord通知(任意。Webhook未設定なら黙ってスキップ — Obsidianへは同期で届く)
  let discordSent = false;
  const webhook = process.env.DISCORD_WEBHOOK_BRIEF;
  if (webhook) {
    try {
      const body = content.length > 1900 ? `${content.slice(0, 1900)}\n…(全文はObsidianで)` : content;
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: body }),
      });
      discordSent = res.ok;
    } catch (e) {
      console.error("Discord通知失敗:", e);
    }
  }

  return NextResponse.json({
    ok: true,
    capture_id: capture.id,
    captures_read: recentCaptures.length,
    discord_sent: discordSent,
  });
}
