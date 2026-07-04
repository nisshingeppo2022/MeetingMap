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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
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
      generateContent(prompt, { thinkingBudget: 0, retries: 1 }),
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
      generateContent(prompt, { thinkingBudget: 0, retries: 1 }),
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
