// ============================================================
// コンテキスト組み立て。設計原則:
//   生徒モードの関数から個人データ取得関数を呼ぶことを禁止する。
//   buildStudentContext は captures 系テーブルに一切アクセスしない
//   (club-shared タグの許可リストクエリ以外)。
//   秘匿はプロンプトではなくコードパスで保証する。
// ============================================================
import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { resolveOwnerUserId } from "./owner";

const dir = (...p: string[]) => path.join(process.cwd(), "companion", ...p);

async function readTextFile(p: string): Promise<string> {
  try {
    return await readFile(p, "utf-8");
  } catch {
    return "";
  }
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const firstLine = (s: string, max: number) => s.split("\n")[0].replace(/^#\s*/, "").slice(0, max);

// ---------- 生徒モード ----------
// 原則: 生徒モードが読めるのは (1) club_context.md と
// (2) 明示的に club-shared タグが付与された captures のみ。
// タグなしの記録は構造的に読めない(クエリにハードコードされたフィルタで保証)。
// 共有は MeetingMap 側での手動タグ付けによるオプトイン。デフォルトは非共有。
// このフィルタ(tags に 'club-shared' を含む)は絶対に削除・緩和しないこと。
export async function buildStudentContext(): Promise<string> {
  const club = await readTextFile(dir("club_context.md"));

  const userId = await resolveOwnerUserId();
  const shared = userId
    ? await prisma.capture.findMany({
        where: { userId, deletedAt: null, tags: { has: "club-shared" } }, // ← ハードコードされた許可リストフィルタ
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { content: true, createdAt: true },
      })
    : [];

  const sharedBlock = shared
    .map((r) => `- [${fmtDate(r.createdAt)}] ${trunc(firstLine(r.content, 60) || r.content, 300)}`)
    .join("\n");

  return [
    club ? `# 部活公開コンテキスト\n${club}` : "",
    sharedBlock
      ? `# 部で共有されている記録(ミーティング等。生徒も同席した内容)\n${sharedBlock}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------- 相談モード ----------
export async function buildConsultContext(userText: string): Promise<string> {
  const soul = await readTextFile(dir("_soul.md"));
  const soulSection = soul ? `# 価値観(_soul.md)\n${soul}` : "";

  const userId = await resolveOwnerUserId();
  if (!userId) return soulSection;

  const recent = await prisma.capture.findMany({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { content: true, createdAt: true },
  });

  // 発話キーワードによる簡易検索(pgvector化は将来)
  const keywords = extractKeywords(userText);
  let related: { content: string; createdAt: Date }[] = [];
  if (keywords.length > 0) {
    related = await prisma.capture.findMany({
      where: {
        userId,
        deletedAt: null,
        OR: keywords.map((k) => ({ content: { contains: k, mode: "insensitive" as const } })),
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { content: true, createdAt: true },
    });
  }

  const fmt = (rows: { content: string; createdAt: Date }[]) =>
    rows
      .map((r) => `- [${fmtDate(r.createdAt)}] ${trunc(firstLine(r.content, 40) || r.content, 200)}`)
      .join("\n");

  return [
    soulSection,
    recent.length ? `# 最近の記録(直近${recent.length}件)\n${fmt(recent)}` : "",
    related.length ? `# 今の話題に関連しそうな記録\n${fmt(related)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function trunc(s: string | null, n: number) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ざっくりしたキーワード抽出: 2文字以上のカタカナ語/漢字連続/英単語を拾う
function extractKeywords(text: string): string[] {
  const m = text.match(/[ァ-ヴー]{2,}|[一-龠々]{2,}|[a-zA-Z]{3,}/g) ?? [];
  return Array.from(new Set(m)).slice(0, 5);
}
