import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { meetingId, expiresInDays } = await request.json();
  if (!meetingId) return NextResponse.json({ error: "meetingId は必須です" }, { status: 400 });

  const token = randomBytes(32).toString("hex");
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const shareLink = await prisma.shareLink.create({
    data: {
      userId: user.id,
      token,
      viewType: "meeting",
      filterConfig: { meetingId },
      expiresAt,
    },
  });

  return NextResponse.json({ token: shareLink.token });
}
