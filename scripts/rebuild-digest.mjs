// プロジェクトの _captures.md を、Vault内の captures/ 配下を走査して作り直すスクリプト。
// 実行: npm run rebuild-digest <slug>
// 追記の重複・破損時のリカバリ用。正本はcaptures/YYYY-MM/配下のファイル群であり、
// _captures.md はいつでもここから再生成できる派生ダイジェスト。

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { findCapturesByTag, ensureProjectScaffold, digestEntry } from "./lib/obsidian-projects.mjs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const VAULT_PATH = "/Users/toshimac/Claudian/マイメモ";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("使い方: npm run rebuild-digest <slug>");
    process.exit(1);
  }

  const { data: tagDef, error } = await supabase
    .from("capture_tag_defs")
    .select("slug, label, is_project")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    console.error("capture_tag_defs取得エラー:", error.message);
    process.exit(1);
  }
  if (!tagDef || !tagDef.is_project) {
    console.error(`"${slug}" はプロジェクトタグとして登録されていません。`);
    process.exit(1);
  }

  const matches = findCapturesByTag(VAULT_PATH, slug);
  const { capturesPath } = ensureProjectScaffold(VAULT_PATH, slug, tagDef.label);

  const header = `# ${tagDef.label} キャプチャダイジェスト\n\n(このファイルは自動生成されます。手で編集しないでください。再生成: npm run rebuild-digest ${slug})\n`;
  const body = matches.map((c) => digestEntry(c)).join("");
  fs.writeFileSync(capturesPath, header + body, "utf-8");

  console.log(`再生成完了: ${slug} (${matches.length}件) -> ${capturesPath}`);
}

main();
