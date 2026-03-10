import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") ?? "20");
  const contactId = searchParams.get("contactId");
  const allNodes = searchParams.get("allNodes") === "true";

  const meetings = await prisma.meeting.findMany({
    where: {
      userId: user.id,
      ...(contactId ? {
        OR: [
          { contactId },
          { meetingContacts: { some: { contactId } } },
        ],
      } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      contact: { select: { id: true, name: true, organization: true } },
      meetingContacts: { include: { contact: { select: { id: true, name: true, organization: true } } } },
      mindmapNodes: allNodes
        ? { orderBy: { sortOrder: "asc" } }
        : { where: { nodeType: "topic" }, select: { id: true, label: true, nodeType: true, status: true } },
    },
  });

  return NextResponse.json(meetings);
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { contactIds, mode } = body;
  const contactIdList: string[] = Array.isArray(contactIds) ? contactIds : (body.contactId ? [body.contactId] : []);

  if (!mode) return NextResponse.json({ error: "modeは必須です" }, { status: 400 });

  const meeting = await prisma.meeting.create({
    data: {
      userId: user.id,
      contactId: contactIdList[0] ?? null,
      mode,
      status: "recording",
      ...(contactIdList.length > 0 && {
        meetingContacts: {
          create: contactIdList.map((cid) => ({ contactId: cid })),
        },
      }),
    },
  });

  return NextResponse.json(meeting, { status: 201 });
}
