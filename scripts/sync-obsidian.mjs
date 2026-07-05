// Supabase の captures を Obsidian Vault に Markdown として書き出す同期スクリプト。
// 実行: npm run sync
//
// 認証について: 現状ユーザーは自分1人のみのため、Supabase Auth のログインフローは
// 挟まず service_role キーで直接読み書きする(RLSはバイパスされるが、単一ユーザー
// 運用のため実害はない)。複数ユーザー運用に拡張する場合は要見直し。

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { appendToDigest, rebuildDigestFromFiles } from "./lib/obsidian-projects.mjs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const VAULT_PATH = "/Users/toshimac/Claudian/マイメモ";
const CAPTURES_DIR = path.join(VAULT_PATH, "captures");
const MEETINGS_DIR = path.join(CAPTURES_DIR, "meetings");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function toJstIso(date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const y = jst.getUTCFullYear();
  const mo = pad(jst.getUTCMonth() + 1);
  const d = pad(jst.getUTCDate());
  const h = pad(jst.getUTCHours());
  const mi = pad(jst.getUTCMinutes());
  const s = pad(jst.getUTCSeconds());
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`;
}

function filePathFor(capture) {
  const created = new Date(capture.created_at);
  const jst = new Date(created.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const y = jst.getUTCFullYear();
  const mo = pad(jst.getUTCMonth() + 1);
  const d = pad(jst.getUTCDate());
  const hh = pad(jst.getUTCHours());
  const mm = pad(jst.getUTCMinutes());
  const idPrefix = capture.id.slice(0, 8);
  const fileName = `${y}-${mo}-${d}-${hh}${mm}-${idPrefix}.md`;

  if (capture.source === "meetingmap") {
    return { dir: MEETINGS_DIR, filePath: path.join(MEETINGS_DIR, fileName) };
  }
  const monthDir = path.join(CAPTURES_DIR, `${y}-${mo}`);
  return { dir: monthDir, filePath: path.join(monthDir, fileName) };
}

function yamlList(arr) {
  return arr && arr.length > 0 ? `[${arr.join(", ")}]` : "[]";
}

function buildMarkdown(capture) {
  const lines = [
    "---",
    `source: ${capture.source}`,
    `tags: ${yamlList(capture.tags)}`,
    `created: ${toJstIso(new Date(capture.created_at))}`,
    `capture_id: ${capture.id}`,
  ];

  // クリップ由来の付加情報(あるものだけ書き出す)
  if (capture.url) lines.push(`url: ${capture.url}`);
  if (capture.why) lines.push(`why: ${capture.why}`);
  if (capture.summary) lines.push(`summary: ${capture.summary}`);
  if (capture.use_for && capture.use_for.length > 0) lines.push(`use_for: ${yamlList(capture.use_for)}`);
  if (capture.keywords && capture.keywords.length > 0) lines.push(`keywords: ${yamlList(capture.keywords)}`);

  lines.push("---", "", capture.content, "");
  return lines.join("\n");
}

// 週次Dreamingが積んだ_soul.mdへの追記候補(app_config: soul_pending)を
// Vault側の _soul.md の「自動追記」セクションに日付付きで書き足す。
// 正本はあくまでVault側(追記後にsyncSoulがDBへ反映し直す)
async function applySoulPending() {
  const soulPath = path.join(VAULT_PATH, "_soul.md");
  if (!fs.existsSync(soulPath)) return;

  const { data: pendingRow } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "soul_pending")
    .maybeSingle();
  if (!pendingRow) return;

  let pending = [];
  try {
    pending = JSON.parse(pendingRow.value);
  } catch {
    pending = [];
  }
  if (!Array.isArray(pending) || pending.length === 0) return;

  const today = toJstIso(new Date()).slice(0, 10);
  let content = fs.readFileSync(soulPath, "utf-8");
  const heading = "## 自動追記（週次ふりかえりより）";
  if (!content.includes(heading)) {
    content = `${content.replace(/\n+$/, "")}\n\n${heading}\n`;
  }
  const lines = pending.map((p) => `- ${today}: ${p}`).join("\n");
  content = `${content.replace(/\n+$/, "")}\n${lines}\n`;
  fs.writeFileSync(soulPath, content, "utf-8");

  await supabase.from("app_config").delete().eq("key", "soul_pending");
  console.log(`_soul.md に自動追記 ${pending.length}件(週次ふりかえりより)。`);
}

// _soul.md(本人の価値観・トーンルール)をapp_configへ反映する。
// 内容が変わった時だけupsertし、consult APIと週次Dreamingが参照する(15.3)
async function syncSoul() {
  const soulPath = path.join(VAULT_PATH, "_soul.md");
  if (!fs.existsSync(soulPath)) return;
  const value = fs.readFileSync(soulPath, "utf-8").trim();
  if (!value) return;

  const { data: existing } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "soul")
    .maybeSingle();
  if (existing && existing.value === value) return;

  const { error } = await supabase
    .from("app_config")
    .upsert({ key: "soul", value, updated_at: new Date().toISOString() });
  if (error) {
    console.error("_soul.md の反映エラー:", error.message);
  } else {
    console.log("_soul.md の変更をapp_configへ反映しました。");
  }
}

async function main() {
  if (!fs.existsSync(VAULT_PATH)) {
    console.error(`Vaultが見つかりません: ${VAULT_PATH}`);
    process.exit(1);
  }

  await applySoulPending();
  await syncSoul();

  const { data: projectTagDefs, error: tagDefsError } = await supabase
    .from("capture_tag_defs")
    .select("slug, label")
    .eq("is_project", true);
  if (tagDefsError) {
    console.error("capture_tag_defs取得エラー:", tagDefsError.message);
    process.exit(1);
  }
  const projectLabelBySlug = new Map((projectTagDefs ?? []).map((t) => [t.slug, t.label]));

  const { data: captures, error } = await supabase
    .from("captures")
    .select("*")
    .eq("synced_to_obsidian", false)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("captures取得エラー:", error.message);
    process.exit(1);
  }

  let written = 0;
  let skipped = 0;
  let failed = 0;
  let digestAppended = 0;

  for (const capture of captures ?? []) {
    const { dir, filePath } = filePathFor(capture);
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      if (fs.existsSync(filePath)) {
        // 既にファイルがある場合は書き直さず、フラグだけ揃える(冪等性)
        skipped++;
      } else {
        fs.writeFileSync(filePath, buildMarkdown(capture), "utf-8");
        written++;
      }

      // プロジェクトタグが付いている場合は、対応するプロジェクトのダイジェストにも追記する
      for (const tag of capture.tags) {
        if (projectLabelBySlug.has(tag)) {
          appendToDigest(VAULT_PATH, tag, projectLabelBySlug.get(tag), capture);
          digestAppended++;
        }
      }

      const { error: updateError } = await supabase
        .from("captures")
        .update({ synced_to_obsidian: true })
        .eq("id", capture.id);
      if (updateError) throw updateError;
    } catch (e) {
      failed++;
      console.error(`同期失敗 (capture_id=${capture.id}):`, e.message);
    }
  }

  // --- 削除予約されたキャプチャの処理(相談履歴の削除に連動) ---
  // Vault内のファイルを削除→関係するプロジェクトダイジェストを再生成→DBから完全削除
  const { data: deletedCaptures, error: deletedError } = await supabase
    .from("captures")
    .select("*")
    .not("deleted_at", "is", null);
  if (deletedError) {
    console.error("削除予約captures取得エラー:", deletedError.message);
  }

  let filesDeleted = 0;
  let rowsDeleted = 0;
  const affectedProjects = new Map();

  for (const capture of deletedCaptures ?? []) {
    try {
      const { filePath } = filePathFor(capture);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        filesDeleted++;
      }
      for (const tag of capture.tags) {
        if (projectLabelBySlug.has(tag)) {
          affectedProjects.set(tag, projectLabelBySlug.get(tag));
        }
      }
      const { error: hardDeleteError } = await supabase
        .from("captures")
        .delete()
        .eq("id", capture.id);
      if (hardDeleteError) throw hardDeleteError;
      rowsDeleted++;
    } catch (e) {
      console.error(`削除失敗 (capture_id=${capture.id}):`, e.message);
    }
  }

  for (const [slug, label] of affectedProjects) {
    rebuildDigestFromFiles(VAULT_PATH, slug, label);
    console.log(`プロジェクトダイジェスト再生成: ${slug}`);
  }

  if ((captures ?? []).length === 0 && rowsDeleted === 0) {
    console.log("同期待ち・削除待ちのキャプチャはありません。");
    return;
  }

  console.log(
    `同期完了: 新規書き出し ${written}件 / 既存ファイルのためスキップ ${skipped}件 / 失敗 ${failed}件` +
    (digestAppended > 0 ? ` / プロジェクトダイジェスト追記 ${digestAppended}件` : "") +
    (rowsDeleted > 0 ? ` / 削除 ${rowsDeleted}件(ファイル${filesDeleted}件)` : "")
  );
}

main();
