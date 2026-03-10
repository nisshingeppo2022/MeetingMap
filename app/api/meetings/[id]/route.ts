import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      contact: true,
      meetingContacts: { include: { contact: { select: { id: true, name: true, organization: true } } } },
      mindmapNodes: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(meeting);
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { title, transcript, transcriptSegments, aiAnalysis, status, durationSeconds, audioUrl, date, contactId, contactIds } = body;

  // contactIds（複数）が渡された場合は中間テーブルを更新
  if (contactIds !== undefined) {
    const idList: string[] = Array.isArray(contactIds) ? contactIds : [];
    await prisma.$transaction([
      prisma.meetingContact.deleteMany({ where: { meetingId: params.id } }),
      ...(idList.length > 0 ? [
        prisma.meetingContact.createMany({
          data: idList.map((cid) => ({ meetingId: params.id, contactId: cid })),
          skipDuplicates: true,
        }),
      ] : []),
      prisma.meeting.updateMany({
        where: { id: params.id, userId: user.id },
        data: { contactId: idList[0] ?? null },
      }),
    ]);
    return NextResponse.json({ success: true });
  }

  const meeting = await prisma.meeting.updateMany({
    where: { id: params.id, userId: user.id },
    data: {
      ...(title !== undefined && { title }),
      ...(transcript !== undefined && { transcript }),
      ...(transcriptSegments !== undefined && { transcriptSegments }),
      ...(aiAnalysis !== undefined && { aiAnalysis }),
      ...(status !== undefined && { status }),
      ...(durationSeconds !== undefined && { durationSeconds }),
      ...(audioUrl !== undefined && { audioUrl }),
      ...(date !== undefined && { date: new Date(date) }),
      ...(contactId !== undefined && { contactId: contactId || null }),
    },
  });

  if (meeting.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await prisma.meeting.deleteMany({
    where: { id: params.id, userId: user.id },
  });

  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
