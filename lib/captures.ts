import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { generateContent, CAPTURE_TAG_PROMPT, CLIP_ENRICH_PROMPT } from "@/lib/gemini";

const CLASSIFY_TIMEOUT_MS = 3000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function verifyDeviceToken(token: string): Promise<{ userId: string; tokenId: string } | null> {
  const tokenHash = hashToken(token);
  const record = await prisma.deviceToken.findUnique({ where: { tokenHash } });
  if (!record || !record.active) return null;
  await prisma.deviceToken.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  });
  return { userId: record.userId, tokenId: record.id };
}

export interface ClassifyResult {
  tags: string[];
  confidence: "high" | "low";
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

// captureの本文を分類する。失敗・タイムアウト時は必ず ['inbox'] を返す
// (取りこぼしゼロを最優先し、例外を投げない)
export async function classifyCapture(
  content: string,
  tagDefs: { slug: string; label: string; description: string | null }[]
): Promise<ClassifyResult> {
  const fallback: ClassifyResult = { tags: ["inbox"], confidence: "low" };
  if (tagDefs.length === 0) return fallback;

  const tagListSection = tagDefs
    .map((t) => `- ${t.slug}: ${t.label}${t.description ? `(${t.description})` : ""}`)
    .join("\n");

  const prompt = `${CAPTURE_TAG_PROMPT}

## タグ定義一覧
${tagListSection}

## メモ本文
${content}`;

  try {
    const raw = await withTimeout(
      generateContent(prompt, { thinkingBudget: 0, retries: 1, fallbackModel: "gemini-2.5-flash-lite" }),
      CLASSIFY_TIMEOUT_MS
    );
    const stripped = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    const parsed = JSON.parse(jsonMatch[0]);
    const tags: string[] = Array.isArray(parsed.tags) ? parsed.tags : [];
    const confidence = parsed.confidence === "high" ? "high" : "low";
    if (confidence === "low" || tags.length === 0) return fallback;

    const validSlugs = new Set(tagDefs.map((t) => t.slug));
    const filtered = tags.filter((t) => validSlugs.has(t));
    if (filtered.length === 0) return fallback;

    return { tags: filtered, confidence: "high" };
  } catch {
    return fallback;
  }
}

// クイックキャプチャ系UIのallowlist(13章)。環境変数未設定なら全認証ユーザーに許可
// (現状1人運用のため。他ユーザーへの露出を止めたくなったら Vercel に設定する)
export function isQuickCaptureAllowed(userId: string): boolean {
  const raw = process.env.QUICK_CAPTURE_ALLOWED_USER_IDS;
  if (!raw || !raw.trim()) return true;
  return raw.split(",").map((s) => s.trim()).filter(Boolean).includes(userId);
}

export interface ConsultContext {
  contextText: string;
  meetingCount: number;
  memoCount: number;
  clipCount: number;
}

const CONSULT_MAX_CAPTURES = 50;
const CONSULT_RECENT_DAYS = 14;
const CONSULT_MEETING_TAKE = 10; // 含める議事録は最新10件まで
const CONSULT_MEETING_ITEM_MAX = 4000; // 議事録1件あたりの文字数上限
const CONSULT_MEMO_ITEM_MAX = 2000; // メモ/クリップ1件あたりの文字数上限
const CONSULT_CONTEXT_TOTAL_MAX = 60000; // 文脈全体の文字数上限(Geminiレート制限対策)

function clipText(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n…(長いため省略)` : s;
}

// 相談モードの文脈を captures から組み立てる(14.2)。
// tagSlug指定時はそのタグのcaptures、未指定時は直近2週間のタグ横断。
// source=meetingmap の議事録は件数枠とは別に必ず含める
export async function buildConsultContext(
  userId: string,
  tagSlug: string | null
): Promise<ConsultContext> {
  const baseWhere = tagSlug
    ? { userId, tags: { has: tagSlug } }
    : { userId, createdAt: { gte: new Date(Date.now() - CONSULT_RECENT_DAYS * 24 * 60 * 60 * 1000) } };

  const [memos, meetings] = await Promise.all([
    prisma.capture.findMany({
      where: { ...baseWhere, source: { not: "meetingmap" } },
      orderBy: { createdAt: "desc" },
      take: CONSULT_MAX_CAPTURES,
      select: { source: true, content: true, summary: true, why: true, url: true, createdAt: true },
    }),
    prisma.capture.findMany({
      where: { ...baseWhere, source: "meetingmap" },
      orderBy: { createdAt: "desc" },
      take: CONSULT_MEETING_TAKE,
      select: { source: true, content: true, createdAt: true },
    }),
  ]);

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });

  // meetingsは新しい順で来る(末尾が最古)
  const meetingSections: string[] = meetings.map(
    (m) => `[議事録 ${fmtDate(m.createdAt)}]\n${clipText(m.content, CONSULT_MEETING_ITEM_MAX)}`
  );
  let clipCount = 0;
  const memoSections: string[] = [];
  // 古い順に並べ直して時系列で読めるようにする(先頭が最古)
  for (const c of [...memos].reverse()) {
    if (c.source === "clip") {
      clipCount++;
      const meta = [c.summary && `要約: ${c.summary}`, c.why && `なぜ: ${c.why}`, c.url && `出典: ${c.url}`]
        .filter(Boolean)
        .join(" / ");
      memoSections.push(`[クリップ ${fmtDate(c.createdAt)}]${meta ? `\n(${meta})` : ""}\n${clipText(c.content, CONSULT_MEMO_ITEM_MAX)}`);
    } else {
      memoSections.push(`[メモ ${fmtDate(c.createdAt)}]\n${clipText(c.content, CONSULT_MEMO_ITEM_MAX)}`);
    }
  }

  // 全体量の上限を超える場合、古いメモ→古い議事録の順に間引く(レート制限対策)
  const size = (arr: string[]) => arr.reduce((a, s) => a + s.length + 7, 0);
  while (size(meetingSections) + size(memoSections) > CONSULT_CONTEXT_TOTAL_MAX && memoSections.length > 0) {
    memoSections.shift();
  }
  while (size(meetingSections) + size(memoSections) > CONSULT_CONTEXT_TOTAL_MAX && meetingSections.length > 1) {
    meetingSections.pop();
  }

  return {
    contextText: [...meetingSections, ...memoSections].join("\n\n---\n\n"),
    meetingCount: meetings.length,
    memoCount: memos.length - clipCount,
    clipCount,
  };
}

export interface ClipEnrichment {
  summary: string;
  useFor: string[];
  keywords: string[];
  why: string;
}

// クリップ(他者の言葉の引用)にsummary/use_for/keywords/whyを付与する。
// 失敗・タイムアウト時は空のエンリッチメントを返す(取りこぼしゼロを優先)
export async function enrichClip(content: string, why: string | null): Promise<ClipEnrichment> {
  const fallback: ClipEnrichment = { summary: "", useFor: [], keywords: [], why: why ?? "" };

  const prompt = `${CLIP_ENRICH_PROMPT}

## なぜ気になったか(入力・空の場合は推定すること)
${why ?? "(未入力)"}

## クリップ本文
${content}`;

  try {
    const raw = await withTimeout(
      generateContent(prompt, { thinkingBudget: 0, retries: 1, fallbackModel: "gemini-2.5-flash-lite" }),
      CLASSIFY_TIMEOUT_MS
    );
    const stripped = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      useFor: Array.isArray(parsed.use_for) ? parsed.use_for : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      why: typeof parsed.why === "string" && parsed.why ? parsed.why : (why ?? ""),
    };
  } catch {
    return fallback;
  }
}
