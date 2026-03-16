import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { generateContent, BRIEFING_PROMPT } from "@/lib/gemini";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const meetingId = searchParams.get("meetingId");
    if (!meetingId) return NextResponse.json({ error: "meetingId は必須です" }, { status: 400 });

    // 対象ミーティングを取得
    const meeting = await prisma.meeting.findFirst({
      where: { id: meetingId, userId: user.id },
      include: {
        meetingContacts: { include: { contact: { select: { id: true, name: true, organization: true } } } },
      },
    });

    if (!meeting) return NextResponse.json({ error: "ミーティングが見つかりません" }, { status: 404 });
    if (!meeting.agenda?.trim()) {
      return NextResponse.json({ error: "アジェンダが設定されていません" }, { status: 400 });
    }

    const contactNames = meeting.meetingContacts.map((mc) => mc.contact.name);
    const contactIds = meeting.meetingContacts.map((mc) => mc.contact.id);

    // 同じ参加者との過去ミーティング（最新5件）
    const contactMeetings = contactIds.length > 0
      ? await prisma.meeting.findMany({
          where: {
            userId: user.id,
            status: "completed",
            id: { not: meetingId },
            meetingContacts: { some: { contactId: { in: contactIds } } },
          },
          orderBy: { date: "desc" },
          take: 5,
          include: {
            mindmapNodes: {
              where: { nodeType: { in: ["root", "topic"] }, isVisible: true },
              orderBy: { sortOrder: "asc" },
            },
          },
        })
      : [];

    // 全体の完了済みミーティング（最新10件、上記と重複しないもの）
    const contactMeetingIds = new Set(contactMeetings.map((m) => m.id));
    const recentMeetings = await prisma.meeting.findMany({
      where: {
        userId: user.id,
        status: "completed",
        id: { not: meetingId, notIn: Array.from(contactMeetingIds) },
      },
      orderBy: { date: "desc" },
      take: 10,
      include: {
        mindmapNodes: {
          where: { nodeType: { in: ["root", "topic"] }, isVisible: true },
          orderBy: { sortOrder: "asc" },
        },
        meetingContacts: { include: { contact: { select: { name: true } } } },
      },
    });

    // またクイックメモも取得（最新20件）
    const memos = await prisma.quickMemo.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    // 過去ミーティングサマリーを構築
    const formatMeeting = (m: typeof recentMeetings[0], label: string) => {
      const root = m.mindmapNodes.find((n) => n.nodeType === "root");
      const topics = m.mindmapNodes.filter((n) => n.nodeType === "topic").map((n) => n.label).join("、");
      const title = m.title ?? root?.label ?? "タイトルなし";
      const date = new Date(m.date).toLocaleDateString("ja-JP");
      const contacts = (m as typeof recentMeetings[0]).meetingContacts?.map((mc) => mc.contact.name).join("、") ?? "";
      return `${label}：${title}（${date}${contacts ? " / " + contacts : ""}）\nトピック：${topics || "なし"}`;
    };

    const contactMeetingSummaries = contactMeetings.map((m, i) =>
      formatMeeting(m as typeof recentMeetings[0], `参加者関連会議${i + 1}`)
    ).join("\n\n");

    const recentMeetingSummaries = recentMeetings.map((m, i) =>
      formatMeeting(m, `最近の会議${i + 1}`)
    ).join("\n\n");

    const memoSummary = memos.length > 0
      ? memos.map((m) => `・${m.content}`).join("\n")
      : "なし";

    const prompt = `${BRIEFING_PROMPT}

## 今回のミーティング情報
アジェンダ：${meeting.agenda}
参加者：${contactNames.length > 0 ? contactNames.join("、") : "未設定"}

## 参加者との過去のミーティング
${contactMeetingSummaries || "なし"}

## その他の最近のミーティング
${recentMeetingSummaries || "なし"}

## クイックメモ（会議外のアイデア）
${memoSummary}`;

    const raw = await generateContent(prompt, { thinkingBudget: 0 });
    const jsonText = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      console.error("[briefing] JSONパースエラー:", jsonText.slice(0, 500));
      return NextResponse.json({ error: "AI分析結果のパースに失敗しました" }, { status: 500 });
    }

    return NextResponse.json(parsed);
  } catch (e) {
    console.error("[briefing] ERROR:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
