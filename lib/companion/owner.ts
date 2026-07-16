import { prisma } from "@/lib/prisma";

// ロボホンはSupabaseセッションを持たないため、captures/meetingsの持ち主(userId)を
// 環境変数から解決する。weekly-dreaming cron (app/api/cron/weekly-dreaming/route.ts) と
// 同じパターン: 未設定でもcapturesの持ち主が1人だけなら単一ユーザー運用とみなす。
export async function resolveOwnerUserId(): Promise<string | null> {
  const envId = process.env.CAPTURE_OWNER_USER_ID;
  if (envId) return envId;
  const owners = await prisma.capture.groupBy({ by: ["userId"] });
  return owners.length === 1 ? owners[0].userId : null;
}
