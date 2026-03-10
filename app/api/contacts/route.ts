import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";

  const contacts = await prisma.contact.findMany({
    where: {
      userId: user.id,
      ...(q ? {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { organization: { contains: q, mode: "insensitive" } },
        ],
      } : {}),
    },
    orderBy: { name: "asc" },
    include: { _count: { select: { meetings: true } } },
  });

  return NextResponse.json(contacts);
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { name, organization, position, email, phone, notes, businessCardUrl, businessCardOcr } = body;

  if (!name) return NextResponse.json({ error: "名前は必須です" }, { status: 400 });

  const contact = await prisma.contact.create({
    data: {
      userId: user.id, name, organization, position, email, phone, notes,
      ...(businessCardUrl && { businessCardUrl }),
      ...(businessCardOcr && { businessCardOcr }),
    },
  });

  return NextResponse.json(contact, { status: 201 });
}
