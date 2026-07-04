import { prisma } from "@/lib/prisma";
import { verifyDeviceToken, classifyCapture } from "@/lib/captures";
import { NextRequest, NextResponse } from "next/server";
import type { CaptureSource } from "@prisma/client";

export const maxDuration = 15;

const VALID_SOURCES: CaptureSource[] = ["shortcut", "voice", "line", "obsidian", "meetingmap"];

// 共通インジェストAPI。デバイストークン(Bearer)で認証する
// (Webセッションではなく、ショートカット等の外部デバイスからの呼び出しを想定)
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice("Bearer ".length);
  const auth = await verifyDeviceToken(token);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const content: string = typeof body.content === "string" ? body.content.trim() : "";
  const source: CaptureSource = VALID_SOURCES.includes(body.source) ? body.source : "shortcut";
  const explicitTags: string[] | undefined = Array.isArray(body.tags) ? body.tags : undefined;

  if (!content) {
    return NextResponse.json({ error: "content は必須です" }, { status: 400 });
  }

  const capture = await prisma.capture.create({
    data: {
      userId: auth.userId,
      source,
      content,
      tags: explicitTags ?? [],
    },
  });

  let tags = explicitTags ?? [];
  if (!explicitTags || explicitTags.length === 0) {
    const tagDefs = await prisma.captureTagDef.findMany({
      where: { active: true },
      select: { slug: true, label: true, description: true },
      orderBy: { sortOrder: "asc" },
    });
    const result = await classifyCapture(content, tagDefs);
    tags = result.tags;
    await prisma.capture.update({ where: { id: capture.id }, data: { tags } });
  }

  const firstTagDef = tags.length > 0
    ? await prisma.captureTagDef.findUnique({ where: { slug: tags[0] }, select: { label: true } })
    : null;

  return NextResponse.json({
    capture_id: capture.id,
    tags,
    label: firstTagDef?.label ?? tags[0] ?? null,
  });
}
