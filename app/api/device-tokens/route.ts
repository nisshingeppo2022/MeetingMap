import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/captures";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

// 発行済みトークン一覧(平文は返さない)
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tokens = await prisma.deviceToken.findMany({
    where: { userId: user.id },
    select: { id: true, deviceName: true, active: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(tokens);
}

// 新規デバイストークンを発行する。平文トークンはこのレスポンスでのみ返す
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const deviceName: string | null = body.deviceName ?? null;

  const token = randomBytes(32).toString("hex");
  const created = await prisma.deviceToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      deviceName,
      active: true,
    },
  });

  return NextResponse.json({ id: created.id, token, deviceName: created.deviceName }, { status: 201 });
}
