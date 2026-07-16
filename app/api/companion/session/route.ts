import { NextRequest, NextResponse } from "next/server";
import { issueConsultToken } from "@/lib/companion/auth";

export const runtime = "nodejs";

// PINの正誤ヒントを与えない固定文言
const DENY = { error: "認証できませんでした" };

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.device_token || !body?.pin) return NextResponse.json(DENY, { status: 400 });

  const result = await issueConsultToken(body.device_token, String(body.pin));
  if (!result.ok) return NextResponse.json(DENY, { status: result.status });

  return NextResponse.json({ consult_token: result.token, expires_at: result.expires_at });
}
