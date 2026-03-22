import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 10;

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { transcript, meetingId, append } = await request.json();
  if (!transcript || !meetingId) {
    return NextResponse.json({ error: "transcript と meetingId は必須です" }, { status: 400 });
  }

  let finalTranscript = transcript;
  if (append) {
    const existing = await prisma.meeting.findFirst({
      where: { id: meetingId, userId: user.id },
      select: { transcript: true },
    });
    if (existing?.transcript) {
      finalTranscript = existing.transcript + "\n\n" + transcript;
    }
  }

  await prisma.meeting.updateMany({
    where: { id: meetingId, userId: user.id },
    data: { transcript: finalTranscript, status: "processing" },
  });

  return NextResponse.json({ success: true });
}
