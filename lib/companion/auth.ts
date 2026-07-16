import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

export type Mode = "student" | "consult";

export interface Device {
  id: string;
  label: string;
  allowedModes: string[];
}

export async function getDevice(token: string | undefined): Promise<Device | null> {
  if (!token) return null;
  const row = await prisma.companionDeviceToken.findUnique({
    where: { token },
    select: { id: true, label: true, allowedModes: true, revokedAt: true },
  });
  if (!row || row.revokedAt) return null;
  return { id: row.id, label: row.label, allowedModes: row.allowedModes };
}

// アイドル失効方式: 有効な consult_token で発話するたびに期限を「いま+IDLE分」へ延長する。
// 話し続けている限り切れない。無操作が IDLE 分続くと自動失効。
// フェイルセーフ原則: consult_token が完全に有効なときだけ consult。それ以外は常に student。
export async function resolveMode(device: Device, consultToken?: string): Promise<Mode> {
  if (!consultToken) return "student";
  const row = await prisma.companionConsultSession.findUnique({
    where: { token: consultToken },
    select: { id: true, expiresAt: true, deviceTokenId: true },
  });
  if (!row) return "student";
  if (row.deviceTokenId !== device.id) return "student";
  if (row.expiresAt.getTime() < Date.now()) return "student";

  // スライド延長(発話 = 在席の証拠)
  await prisma.companionConsultSession.update({
    where: { id: row.id },
    data: { expiresAt: new Date(Date.now() + IDLE_MINUTES * 60_000) },
  });
  return "consult";
}

const LOCK_AFTER = 5;          // 連続失敗回数
const LOCK_MINUTES = 10;       // ロック時間
// アイドル失効ウィンドウ(分)。発話ごとに延長される。環境変数で調整可。
const IDLE_MINUTES = Number(process.env.COMPANION_IDLE_MINUTES || 5);

export async function issueConsultToken(
  deviceToken: string,
  pin: string
): Promise<{ ok: true; token: string; expires_at: string } | { ok: false; status: number }> {
  const dev = await prisma.companionDeviceToken.findUnique({
    where: { token: deviceToken },
    select: {
      id: true,
      revokedAt: true,
      failedPinCount: true,
      lockedUntil: true,
      allowedModes: true,
    },
  });
  if (!dev || dev.revokedAt) return { ok: false, status: 401 };
  // このデバイスに相談モードが許可されているか(PINが正しくても許可なしなら拒否)
  if (!dev.allowedModes || !dev.allowedModes.includes("consult"))
    return { ok: false, status: 401 };
  if (dev.lockedUntil && dev.lockedUntil.getTime() > Date.now())
    return { ok: false, status: 429 };

  const hash = process.env.COMPANION_PIN_HASH!;
  const valid = await bcrypt.compare(pin, hash);
  if (!valid) {
    const count = dev.failedPinCount + 1;
    await prisma.companionDeviceToken.update({
      where: { id: dev.id },
      data: {
        failedPinCount: count,
        lockedUntil:
          count >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    });
    return { ok: false, status: 401 };
  }

  await prisma.companionDeviceToken.update({
    where: { id: dev.id },
    data: { failedPinCount: 0, lockedUntil: null },
  });
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + IDLE_MINUTES * 60_000);
  await prisma.companionConsultSession.create({
    data: { token, deviceTokenId: dev.id, expiresAt },
  });
  return { ok: true, token, expires_at: expiresAt.toISOString() };
}
