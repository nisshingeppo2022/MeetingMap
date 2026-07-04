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

export interface ConsultSource {
  kind: "議事録" | "会議" | "メモ" | "クリップ";
  date: string;
  title: string;
  excerpt: string;
}

export interface ConsultContext {
  contextText: string;
  meetingCount: number;
  memoCount: number;
  clipCount: number;
  sources: ConsultSource[];
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

interface ContextEntry {
  text: string;
  source: ConsultSource;
}

// 相談モードの文脈を captures + meetings から組み立てる(14.2)。
// tagSlug指定時はそのタグのcaptures + タグ名に合致する会議、未指定時は直近2週間。
// 「Obsidianへ送る」済みの議事録(capture)に加え、未送信の会議もマインドマップの
// 要約ダイジェストとして含める(押し忘れてもAIが会議を知っている状態にする)
export async function buildConsultContext(
  userId: string,
  tagSlug: string | null
): Promise<ConsultContext> {
  const recentCutoff = new Date(Date.now() - CONSULT_RECENT_DAYS * 24 * 60 * 60 * 1000);
  const baseWhere = tagSlug
    ? { userId, tags: { has: tagSlug } }
    : { userId, createdAt: { gte: recentCutoff } };

  const [memos, meetingCaptures, tagDef] = await Promise.all([
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
      select: {
        source: true, content: true, createdAt: true, meetingId: true,
        meeting: { select: { title: true, date: true } },
      },
    }),
    tagSlug
      ? prisma.captureTagDef.findUnique({ where: { slug: tagSlug }, select: { label: true } })
      : Promise.resolve(null),
  ]);

  // 🗂️未送信の会議もmeetingsテーブルから直接読む(送信済みの会議は除外して重複を避ける)
  const capturedMeetingIds = meetingCaptures
    .map((c) => c.meetingId)
    .filter((id): id is string => !!id);
  const meetingScope = tagSlug
    ? tagDef
      ? {
          OR: [
            { title: { contains: tagDef.label } },
            { meetingTopics: { some: { topic: { name: { contains: tagDef.label } } } } },
          ],
        }
      : null
    : { date: { gte: recentCutoff } };
  const directMeetings = meetingScope
    ? await prisma.meeting.findMany({
        where: { userId, id: { notIn: capturedMeetingIds }, ...meetingScope },
        orderBy: { date: "desc" },
        take: CONSULT_MEETING_TAKE,
        select: {
          title: true,
          date: true,
          contact: { select: { name: true } },
          mindmapNodes: {
            where: { isVisible: true },
            select: { id: true, parentId: true, label: true, nodeType: true, status: true },
            take: 200,
          },
        },
      })
    : [];

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
  const firstLine = (s: string, max: number) => s.split("\n")[0].slice(0, max);

  // 議事録(Obsidianへ送信済みのcapture)。日付は送信日ではなく本来の会議日を使う
  const meetingEntries: ContextEntry[] = meetingCaptures.map((c) => {
    const date = fmtDate(c.meeting?.date ?? c.createdAt);
    const title = c.meeting?.title ?? firstLine(c.content, 40);
    return {
      text: `[議事録 ${date}] ${title}\n${clipText(c.content, CONSULT_MEETING_ITEM_MAX)}`,
      source: { kind: "議事録", date, title, excerpt: c.content.slice(0, 300) },
    };
  });

  // 未送信会議のマインドマップ・ダイジェスト
  const directMeetingEntries: ContextEntry[] = directMeetings.map((m) => {
    const lines: string[] = [];
    const topics = m.mindmapNodes.filter((n) => n.nodeType === "topic");
    for (const t of topics) {
      const children = m.mindmapNodes.filter((n) => n.parentId === t.id).map((n) => n.label);
      lines.push(`■${t.label}${t.status ? `(${t.status})` : ""}${children.length ? `: ${children.join(" / ")}` : ""}`);
    }
    const actions = m.mindmapNodes.filter((n) => n.nodeType === "action");
    for (const a of actions) {
      lines.push(`→TODO: ${a.label}${a.status ? `(${a.status})` : ""}`);
    }
    const digest = clipText(lines.join("\n"), CONSULT_MEETING_ITEM_MAX);
    const date = fmtDate(m.date);
    const title = m.title ?? "無題の会議";
    const withWho = m.contact?.name ? `${title} (相手: ${m.contact.name})` : title;
    return {
      text: `[会議 ${date}] ${withWho}\n${digest}`,
      source: { kind: "会議", date, title: withWho, excerpt: digest.slice(0, 300) },
    };
  });

  const memoEntries: ContextEntry[] = [];
  // 古い順に並べ直して時系列で読めるようにする(先頭が最古)
  for (const c of [...memos].reverse()) {
    const date = fmtDate(c.createdAt);
    if (c.source === "clip") {
      const meta = [c.summary && `要約: ${c.summary}`, c.why && `なぜ: ${c.why}`, c.url && `出典: ${c.url}`]
        .filter(Boolean)
        .join(" / ");
      memoEntries.push({
        text: `[クリップ ${date}]${meta ? `\n(${meta})` : ""}\n${clipText(c.content, CONSULT_MEMO_ITEM_MAX)}`,
        source: { kind: "クリップ", date, title: c.summary || firstLine(c.content, 40), excerpt: c.content.slice(0, 300) },
      });
    } else {
      memoEntries.push({
        text: `[メモ ${date}]\n${clipText(c.content, CONSULT_MEMO_ITEM_MAX)}`,
        source: { kind: "メモ", date, title: firstLine(c.content, 40), excerpt: c.content.slice(0, 300) },
      });
    }
  }

  // 全体量の上限を超える場合、古いメモ→古い会議→古い議事録の順に間引く(レート制限対策)
  const size = (arr: ContextEntry[]) => arr.reduce((a, e) => a + e.text.length + 7, 0);
  const total = () => size(meetingEntries) + size(directMeetingEntries) + size(memoEntries);
  while (total() > CONSULT_CONTEXT_TOTAL_MAX && memoEntries.length > 0) memoEntries.shift();
  while (total() > CONSULT_CONTEXT_TOTAL_MAX && directMeetingEntries.length > 1) directMeetingEntries.pop();
  while (total() > CONSULT_CONTEXT_TOTAL_MAX && meetingEntries.length > 1) meetingEntries.pop();

  const included = [...meetingEntries, ...directMeetingEntries, ...memoEntries];
  const countOf = (kinds: ConsultSource["kind"][]) =>
    included.filter((e) => kinds.includes(e.source.kind)).length;

  return {
    contextText: included.map((e) => e.text).join("\n\n---\n\n"),
    meetingCount: countOf(["議事録", "会議"]),
    memoCount: countOf(["メモ"]),
    clipCount: countOf(["クリップ"]),
    sources: included.map((e) => e.source),
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
