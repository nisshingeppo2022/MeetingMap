import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// トークンを無効化する(削除はせず active: false にする)
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const active: boolean = body.active === true;

  const result = await prisma.deviceToken.updateMany({
    where: { id: params.id, userId: user.id },
    data: { active },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
