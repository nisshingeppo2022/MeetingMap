import { NextRequest, NextResponse } from "next/server";
import { getDevice, resolveMode } from "@/lib/companion/auth";
import { getFullLog, clearSession, saveCapture, createMeetingRecord } from "@/lib/companion/store";
import { summarize } from "@/lib/companion/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.session_id) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const device = await getDevice(body.device_token);
  if (!device) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const mode = await resolveMode(device, body.consult_token);

  const log = await getFullLog(body.session_id);
  if (log.length === 0) return NextResponse.json({ error: "empty session" }, { status: 404 });

  // バッファに残っている実際のモード(途中失効対策: ログ側のmodeを優先)
  const sessionMode = log.some((r: any) => r.mode === "consult") && mode === "consult" ? "consult" : "student";

  const fullText = log.map((r: any) => `${r.role === "user" ? "話者" : "相棒"}: ${r.content}`).join("\n");
  const summary = await summarize(fullText);
  const titleLine = summary.split("\n")[0].replace(/^#\s*/, "").trim() || "相棒との対話";

  // 相談モードは先に会議レコードを作り、captureをその会議に紐付ける
  // (Capture.meetingId 経由でマインドマップ生成パイプラインと繋がる)。
  // 会議レコード作成に失敗しても captures 保存は成功として続行する
  let meeting_id: string | undefined;
  if (sessionMode === "consult") {
    try {
      meeting_id = await createMeetingRecord({ title: titleLine, fullLog: fullText });
    } catch (e) {
      console.error("companion: createMeetingRecord failed", e);
    }
  }

  const tags = sessionMode === "consult" ? ["robohon", "consult"] : ["robohon", "stem-club"];
  const capture_id = await saveCapture({
    content: `${summary}\n\n---\n\n## 全文ログ\n${fullText}`,
    tags,
    meetingId: meeting_id,
  });

  await clearSession(body.session_id);
  return NextResponse.json({ summary, capture_id, meeting_id: meeting_id ?? null, mode: sessionMode });
}
