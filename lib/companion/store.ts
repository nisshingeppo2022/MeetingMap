import { prisma } from "@/lib/prisma";
import { Mode } from "./auth";
import { resolveOwnerUserId } from "./owner";

const HISTORY_PAIRS = 10;      // 注入する直近往復数
const HISTORY_CHAR_CAP = 4000; // 履歴の総文字数上限

export async function appendMessage(sessionId: string, mode: Mode, role: "user" | "assistant", content: string) {
  await prisma.companionMessage.create({ data: { sessionId, mode, role, content } });
}

export async function getHistory(sessionId: string): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const rows = await prisma.companionMessage.findMany({
    where: { sessionId },
    orderBy: { id: "desc" },
    take: HISTORY_PAIRS * 2,
    select: { role: true, content: true },
  });
  rows.reverse();
  // 文字数キャップ(古い側から削る)
  let total = rows.reduce((s, r) => s + r.content.length, 0);
  while (rows.length > 0 && total > HISTORY_CHAR_CAP) {
    total -= rows[0].content.length;
    rows.shift();
  }
  return rows as { role: "user" | "assistant"; content: string }[];
}

export async function getFullLog(sessionId: string) {
  return prisma.companionMessage.findMany({
    where: { sessionId },
    orderBy: { id: "asc" },
    select: { role: true, content: true, mode: true, createdAt: true },
  });
}

export async function clearSession(sessionId: string) {
  await prisma.companionMessage.deleteMany({ where: { sessionId } });
}

// captures への保存。source は 'robohon'(CaptureSource enum)。
// title専用カラムは無いため、content の1行目がタイトル相当(既存の相談capture保存
// (app/api/consult/save/route.ts)と同じ規約)。meetingId を渡すとcaptureをその会議に紐付ける。
export async function saveCapture(opts: {
  content: string;
  tags: string[];
  meetingId?: string;
}): Promise<string> {
  const userId = await resolveOwnerUserId();
  if (!userId) {
    throw new Error("対象ユーザーを特定できません。CAPTURE_OWNER_USER_ID を設定してください");
  }
  const capture = await prisma.capture.create({
    data: {
      userId,
      source: "robohon",
      content: opts.content,
      tags: opts.tags,
      meetingId: opts.meetingId ?? null,
    },
    select: { id: true },
  });
  return capture.id;
}

// 相談モードのセッションを「自分との会議」として meetings に登録し、
// 既存のマインドマップ生成パイプライン(/api/ai/analyze、meetings/[id]/resultの「AI分析」ボタン)
// に later 手動で乗せられる状態にする。Meetingモデルに由来(source)を持つカラムが無いため、
// タイトル先頭に「[ロボホン相談]」を付与して識別する(ユーザーとの合意事項)。
export async function createMeetingRecord(opts: {
  title: string;
  fullLog: string;
}): Promise<string> {
  const userId = await resolveOwnerUserId();
  if (!userId) {
    throw new Error("対象ユーザーを特定できません。CAPTURE_OWNER_USER_ID を設定してください");
  }
  const meeting = await prisma.meeting.create({
    data: {
      userId,
      title: `[ロボホン相談] ${opts.title}`,
      mode: "live",
      status: "completed",
      transcript: opts.fullLog,
    },
    select: { id: true },
  });
  return meeting.id;
}
